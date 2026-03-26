import { createHash } from "node:crypto";
import { z } from "zod";
import type { Json } from "@/database.types";
import { listPublishers } from "@/lib/data/publishers";
import { getRunDetailPayload } from "@/lib/data/runs";
import {
  extractArticleCandidatesFromHomepage,
  extractArticleMetadata,
} from "@/lib/extract/article-candidates";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { cleanTextForLLM } from "@/lib/extract/html";
import { generateGeminiJson } from "@/lib/gemini/generate";
import {
  canRetryBriefGeneration,
  getBriefRetryAvailability,
} from "@/lib/runs/brief-retry";
import {
  RUN_BRIEF_MODEL,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RECENCY_WINDOW_MEDIUM_HOURS,
  RUN_RECENCY_WINDOW_SHORT_HOURS,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import {
  createInitialRunMetadata,
  type RunMetadata,
} from "@/lib/runs/progress";
import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import { persistRunProgressSnapshot } from "@/lib/runs/persistence/progress-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const MIN_SOURCES_PER_CLUSTER = 3;
const TARGET_CLUSTER_COUNT = 10;
const MAX_RELEVANT_STORIES = 6;

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logRun(
  runId: string | null,
  message: string,
  context?: Record<string, unknown>,
) {
  const runLabel = runId ?? "none";
  if (context) {
    console.log(
      `[worker:runs] ${new Date().toISOString()} [run:${runLabel}] ${message}`,
      context,
    );
  } else {
    console.log(
      `[worker:runs] ${new Date().toISOString()} [run:${runLabel}] ${message}`,
    );
  }
}

type CandidateSource = {
  publisherId: string;
  publisherName: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
};

type ExtractedArticle = CandidateSource & {
  sourceUrl: string;
  bodyText: string;
};

type PrefetchedArticle = CandidateSource & {
  sourceUrl: string;
  html: string;
};

type RetryFailedExtractionsResult = {
  retriedCount: number;
  succeededCount: number;
  failedCount: number;
  briefPublished: boolean;
};

type PersistedCluster = {
  id: string;
  title: string;
  summary: string | null;
  status:
    | "clustered"
    | "eligible"
    | "selected"
    | "discarded_low_sources"
    | "not_selected";
  sourceCount: number;
  sourceKeys: string[];
};

function toClusterStatus(value: string): PersistedCluster["status"] {
  if (
    value === "clustered" ||
    value === "eligible" ||
    value === "selected" ||
    value === "discarded_low_sources" ||
    value === "not_selected"
  ) {
    return value;
  }
  return "clustered";
}

const clusterSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string().trim().min(1),
      source_keys: z.array(z.string().trim().min(1)).min(1).max(100),
    }),
  ),
});

const clusterResponseJsonSchema = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          source_keys: { type: "array", items: { type: "string" } },
        },
        required: ["title", "source_keys"],
      },
    },
  },
  required: ["stories"],
};

const articleBodySchema = z.object({
  body_text: z.string().trim().min(1),
});

const relevantStoriesSchema = z.object({
  selected_clusters: z
    .array(
      z.object({
        cluster_id: z.string().trim().min(1),
        selection_reason: z.string().trim().min(1).max(220),
        latest_development: z.string().trim().min(1).max(280),
      }),
    )
    .max(MAX_RELEVANT_STORIES),
});

const relevantStoriesResponseJsonSchema = {
  type: "object",
  properties: {
    selected_clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          cluster_id: { type: "string" },
          selection_reason: { type: "string" },
          latest_development: { type: "string" },
        },
        required: ["cluster_id", "selection_reason", "latest_development"],
      },
      maxItems: MAX_RELEVANT_STORIES,
    },
  },
  required: ["selected_clusters"],
};

const briefParagraphSchema = z.object({
  markdown: z.string().trim().min(10),
});

const briefParagraphResponseJsonSchema = {
  type: "object",
  properties: {
    markdown: { type: "string", minLength: 10 },
  },
  required: ["markdown"],
};

function replaceNewlinesWithSpaces(value: string) {
  return value
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSingleLine(value: string | null | undefined) {
  return replaceNewlinesWithSpaces(value ?? "");
}

function toRecentCount(
  values: Array<string | null>,
  nowMs: number,
  windowHours: number,
): number {
  const windowMs = windowHours * 60 * 60 * 1000;
  return values.filter((value) => {
    if (!value) return false;
    const ts = +new Date(value);
    if (!Number.isFinite(ts)) return false;
    const delta = nowMs - ts;
    return delta >= 0 && delta <= windowMs;
  }).length;
}

function toHoursAgo(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const ts = +new Date(iso);
  if (!Number.isFinite(ts)) return null;
  const delta = nowMs - ts;
  if (delta < 0) return 0;
  return Math.round((delta / (1000 * 60 * 60)) * 10) / 10;
}

type ClusterSelectionEvidence = {
  clusterId: string;
  title: string;
  sourceCount: number;
  uniquePublisherCount: number;
  latestPublishedAt: string | null;
  earliestPublishedAt: string | null;
  recentSourceCount6h: number;
  recentSourceCount24h: number;
  latestHeadlines: string[];
  latestDescription: string | null;
};

type SelectionDecision = {
  selectedClusterIds: Set<string>;
  reasonsByClusterId: Map<string, string>;
  latestDevelopmentByClusterId: Map<string, string>;
};

function ensureStartsWithIntroBold(markdown: string): string {
  const trimmed = markdown.trim();
  if (/^\*\*.+?\*\*/.test(trimmed)) return trimmed;
  return `**Top update:** ${trimmed}`;
}

function toCanonicalUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    url.hash = "";
    const removable = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ];
    for (const key of removable) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function getExtractConcurrency(): number {
  const raw = process.env.RUN_EXTRACT_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 5;
  }
  return Math.min(parsed, 20);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function updateRunProgress(
  runId: string,
  patch: {
    status?: "running" | "completed" | "failed" | "cancelled";
    ended_at?: string;
    error_message?: string | null;
    metadata: RunMetadata;
  },
) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("runs")
    .update({
      status: patch.status,
      ended_at: patch.ended_at,
      error_message: patch.error_message ?? null,
      metadata: patch.metadata as Json,
    })
    .eq("id", runId);
  if (error) {
    throw new Error(error.message);
  }
  await persistRunProgressSnapshot(runId, patch.metadata);
}

async function isRunCancelled(runId: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("runs")
    .select("status")
    .eq("id", runId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data?.status === "cancelled";
}

async function extractArticleBodyText(
  url: string,
  cleanedText: string,
  identifiedTitle: string | null,
) {
  return generateGeminiJson(
    [
      "Extract full article text from this plain text.",
      'Return JSON object with only {"body_text":"..."}',
      "body_text must be the full article text, no summaries.",
      identifiedTitle ? `Identified title hint: ${identifiedTitle}` : null,
      `Article URL: ${url}`,
      "Text:",
      cleanedText,
    ]
      .filter(Boolean)
      .join("\n"),
    articleBodySchema,
    { model: RUN_EXTRACT_MODEL },
  );
}

function sourceKeyFor(publisherId: string, canonicalUrl: string) {
  const digest = createHash("sha256")
    .update(publisherId)
    .update("\0")
    .update(canonicalUrl)
    .digest("hex")
    .slice(0, 16);
  return `s_${digest}`;
}

function buildStoryTitle(candidates: CandidateSource[]) {
  const sorted = candidates.slice().sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      return +new Date(b.publishedAt) - +new Date(a.publishedAt);
    }
    if (a.publishedAt && !b.publishedAt) return -1;
    if (!a.publishedAt && b.publishedAt) return 1;
    return a.url.localeCompare(b.url);
  });
  const titled = sorted.find((candidate) => candidate.title?.trim());
  if (titled?.title) return titled.title.trim();
  return "Untitled story cluster";
}

async function clusterCandidatesIntoStories(candidates: CandidateSource[]) {
  const inputLines = candidates.map((candidate) => {
    const sourceKey = sourceKeyFor(
      candidate.publisherId,
      candidate.canonicalUrl,
    );
    const title = toSingleLine(candidate.title) || "(untitled)";
    const publishedAt = candidate.publishedAt ?? "unknown";
    return `${sourceKey} | ${publishedAt} | ${title}`;
  });

  const response = await generateGeminiJson(
    [
      "Group only clearly related sources into specific stories.",
      `Find at least ${TARGET_CLUSTER_COUNT} story clusters.`,
      "Each source_key can appear in at most one story.",
      "Only group sources that describe one concrete event or development.",
      "Leave uncertain sources unassigned.",
      'Return JSON object: {"stories":[{"title":"...","source_keys":["..."]}]}',
      "Candidate sources (one per line: source_key | published_at | title):",
      inputLines.join("\n"),
    ].join("\n"),
    clusterSchema,
    {
      model: RUN_CLUSTER_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: clusterResponseJsonSchema,
      },
    },
  );

  const availableKeys = new Set(
    candidates.map((c) => sourceKeyFor(c.publisherId, c.canonicalUrl)),
  );
  const publisherByKey = new Map(
    candidates.map((candidate) => [
      sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
      candidate.publisherId,
    ]),
  );
  const candidateByKey = new Map(
    candidates.map((candidate) => [
      sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
      candidate,
    ]),
  );
  const usedKeys = new Set<string>();
  const stories: {
    title: string;
    summary: string | null;
    sourceKeys: string[];
  }[] = [];

  for (const story of response.stories) {
    const sourceKeys: string[] = [];
    for (const key of story.source_keys) {
      if (!availableKeys.has(key)) {
        continue;
      }
      if (usedKeys.has(key)) {
        continue;
      }
      usedKeys.add(key);
      sourceKeys.push(key);
    }
    const uniquePublishers = new Set(
      sourceKeys
        .map((key) => publisherByKey.get(key))
        .filter((value): value is string => Boolean(value)),
    );

    if (
      sourceKeys.length >= MIN_SOURCES_PER_CLUSTER &&
      uniquePublishers.size >= MIN_SOURCES_PER_CLUSTER
    ) {
      const storyCandidates = sourceKeys
        .map((key) => candidateByKey.get(key))
        .filter((value): value is CandidateSource => Boolean(value));
      const modelTitle = story.title.trim();
      stories.push({
        title: modelTitle || buildStoryTitle(storyCandidates),
        summary: null,
        sourceKeys,
      });
    }
  }

  return stories;
}

function buildClusterSelectionEvidence(
  clusters: PersistedCluster[],
  sourceByKey: Map<string, CandidateSource>,
): ClusterSelectionEvidence[] {
  const nowMs = Date.now();
  return clusters.map((cluster) => {
    const sources = cluster.sourceKeys
      .map((key) => sourceByKey.get(key))
      .filter((value): value is CandidateSource => Boolean(value));
    const sortedByRecency = sources.slice().sort((a, b) => {
      if (a.publishedAt && b.publishedAt) {
        return +new Date(b.publishedAt) - +new Date(a.publishedAt);
      }
      if (a.publishedAt && !b.publishedAt) return -1;
      if (!a.publishedAt && b.publishedAt) return 1;
      return a.url.localeCompare(b.url);
    });
    const latestPublishedAt =
      sortedByRecency.find((source) => source.publishedAt)?.publishedAt ?? null;
    const earliestPublishedAt =
      sortedByRecency
        .map((source) => source.publishedAt)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => +new Date(a) - +new Date(b))[0] ?? null;
    const latestHeadlines = sortedByRecency
      .map((source) => toSingleLine(source.title))
      .filter((title) => title.length > 0)
      .slice(0, 3);
    const latestDescription =
      sortedByRecency
        .map((source) => source.description)
        .find((value): value is string => Boolean(value?.trim())) ?? null;

    return {
      clusterId: cluster.id,
      title: cluster.title,
      sourceCount: cluster.sourceCount,
      uniquePublisherCount: new Set(sources.map((source) => source.publisherId))
        .size,
      latestPublishedAt,
      earliestPublishedAt,
      recentSourceCount6h: toRecentCount(
        sources.map((source) => source.publishedAt),
        nowMs,
        RUN_RECENCY_WINDOW_SHORT_HOURS,
      ),
      recentSourceCount24h: toRecentCount(
        sources.map((source) => source.publishedAt),
        nowMs,
        RUN_RECENCY_WINDOW_MEDIUM_HOURS,
      ),
      latestHeadlines,
      latestDescription,
    };
  });
}

async function clearPersistedRunClusters(runId: string) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("run_story_clusters")
    .delete()
    .eq("run_id", runId);
  if (error) throw new Error(error.message);
}

async function persistClusters(
  runId: string,
  stories: { title: string; summary: string | null; sourceKeys: string[] }[],
  sourceByKey: Map<string, CandidateSource>,
) {
  const supabase = createSupabaseServiceClient();
  const persisted: PersistedCluster[] = [];

  for (const story of stories) {
    const { data: insertedCluster, error: clusterError } = await supabase
      .from("run_story_clusters")
      .insert({
        run_id: runId,
        title: story.title,
        summary: story.summary,
        status: "clustered",
        source_count: story.sourceKeys.length,
      })
      .select("id,title,summary,status,source_count")
      .single();
    if (clusterError || !insertedCluster) {
      throw new Error(
        clusterError?.message ?? "Unable to persist story cluster",
      );
    }

    const sources = story.sourceKeys
      .map((key) => {
        const source = sourceByKey.get(key);
        if (!source) return null;
        return {
          cluster_id: insertedCluster.id,
          run_id: runId,
          publisher_id: source.publisherId,
          url: source.url,
          canonical_url: source.canonicalUrl,
          title: source.title,
          published_at: source.publishedAt,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    if (sources.length > 0) {
      const { error: sourceError } = await supabase
        .from("run_story_cluster_sources")
        .insert(sources);
      if (sourceError) {
        throw new Error(sourceError.message);
      }
    }

    persisted.push({
      id: insertedCluster.id,
      title: insertedCluster.title,
      summary: insertedCluster.summary,
      status: toClusterStatus(insertedCluster.status),
      sourceCount: insertedCluster.source_count,
      sourceKeys: story.sourceKeys,
    });
  }

  return persisted;
}

async function markEligibleClusters(
  runId: string,
  clusters: PersistedCluster[],
): Promise<PersistedCluster[]> {
  const supabase = createSupabaseServiceClient();
  const next: PersistedCluster[] = [];
  for (const cluster of clusters) {
    const status =
      cluster.sourceCount >= MIN_SOURCES_PER_CLUSTER
        ? "eligible"
        : "discarded_low_sources";
    const { error } = await supabase
      .from("run_story_clusters")
      .update({ status })
      .eq("id", cluster.id)
      .eq("run_id", runId);
    if (error) throw new Error(error.message);
    next.push({ ...cluster, status });
  }
  return next;
}

async function selectRelevantStories(
  clusters: PersistedCluster[],
  evidenceRows: ClusterSelectionEvidence[],
): Promise<SelectionDecision> {
  if (clusters.length === 0) {
    return {
      selectedClusterIds: new Set<string>(),
      reasonsByClusterId: new Map<string, string>(),
      latestDevelopmentByClusterId: new Map<string, string>(),
    };
  }
  const nowMs = Date.now();
  const input = evidenceRows.map((row) => ({
    cluster_id: row.clusterId,
    title: row.title,
    source_count: row.sourceCount,
    publisher_count: row.uniquePublisherCount,
    latest_published_at: row.latestPublishedAt,
    earliest_published_at: row.earliestPublishedAt,
    latest_hours_ago: toHoursAgo(row.latestPublishedAt, nowMs),
    sources_last_6h: row.recentSourceCount6h,
    sources_last_24h: row.recentSourceCount24h,
    latest_headlines: row.latestHeadlines,
    latest_description: row.latestDescription,
  }));

  const response = await generateGeminiJson(
    [
      "Choose the most relevant stories for extraction.",
      `Return exactly ${MAX_RELEVANT_STORIES} cluster IDs when there are at least ${MAX_RELEVANT_STORIES} eligible stories.`,
      `If there are fewer than ${MAX_RELEVANT_STORIES} eligible stories, return all eligible cluster IDs.`,
      "Prioritize public impact and broad relevance.",
      `Prioritize clusters with concrete updates in the last ${RUN_RECENCY_WINDOW_SHORT_HOURS}-${RUN_RECENCY_WINDOW_MEDIUM_HOURS} hours.`,
      "Prefer newest developments over stale recap.",
      "Deprioritize repetitive, low-consequence, or evergreen items when stronger updates exist.",
      "For each selected cluster, return a short selection_reason and latest_development sentence.",
      "Stories:",
      JSON.stringify(input),
    ].join("\n"),
    relevantStoriesSchema,
    {
      model: RUN_RELEVANCE_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: relevantStoriesResponseJsonSchema,
      },
    },
  );

  const eligibleIds = new Set(clusters.map((cluster) => cluster.id));
  const selected = new Set<string>();
  const reasonsByClusterId = new Map<string, string>();
  const latestDevelopmentByClusterId = new Map<string, string>();
  for (const entry of response.selected_clusters) {
    if (!eligibleIds.has(entry.cluster_id)) continue;
    selected.add(entry.cluster_id);
    reasonsByClusterId.set(entry.cluster_id, entry.selection_reason.trim());
    latestDevelopmentByClusterId.set(
      entry.cluster_id,
      entry.latest_development.trim(),
    );
    if (selected.size >= MAX_RELEVANT_STORIES) break;
  }
  return {
    selectedClusterIds: selected,
    reasonsByClusterId,
    latestDevelopmentByClusterId,
  };
}

async function updateClusterSelectionStatuses(
  runId: string,
  eligibleClusters: PersistedCluster[],
  decisions: SelectionDecision,
) {
  const supabase = createSupabaseServiceClient();
  for (const cluster of eligibleClusters) {
    const status = decisions.selectedClusterIds.has(cluster.id)
      ? "selected"
      : "not_selected";
    const selectionReason =
      status === "selected"
        ? (decisions.reasonsByClusterId.get(cluster.id) ?? null)
        : null;
    const { error } = await supabase
      .from("run_story_clusters")
      .update({ status, selection_reason: selectionReason })
      .eq("id", cluster.id)
      .eq("run_id", runId);
    if (error) throw new Error(error.message);
  }
}

async function createAndPublishBriefForRun(runId: string) {
  const supabase = createSupabaseServiceClient();

  const { data: clusterRows, error: clustersError } = await supabase
    .from("run_story_clusters")
    .select("id,source_count,title,selection_reason,created_at")
    .eq("run_id", runId)
    .eq("status", "selected");

  if (clustersError) {
    throw new Error(clustersError.message);
  }

  const selectedClusters = (clusterRows ?? []) as Array<{
    id: string;
    source_count: number;
    title: string;
    selection_reason: string | null;
    created_at: string;
  }>;

  if (selectedClusters.length === 0) return;

  const clusterIds = selectedClusters.map((c) => c.id);
  const { data: sourceRows, error: sourcesError } = await supabase
    .from("run_story_cluster_sources")
    .select(
      "cluster_id,publisher_id,canonical_url,url,title,published_at,publishers(name)",
    )
    .in("cluster_id", clusterIds);

  if (sourcesError) {
    throw new Error(sourcesError.message);
  }

  const sources = (sourceRows ?? []) as Array<{
    cluster_id: string;
    publisher_id: string;
    canonical_url: string;
    url: string;
    title: string | null;
    published_at: string | null;
    publishers: { name: string } | null;
  }>;

  // Fetch extracted article bodies for all sources we selected.
  const urlsByPublisher = new Map<string, Set<string>>();
  for (const source of sources) {
    const set = urlsByPublisher.get(source.publisher_id) ?? new Set<string>();
    set.add(source.canonical_url);
    urlsByPublisher.set(source.publisher_id, set);
  }

  const articleTextByKey = new Map<string, string>();
  for (const [publisherId, canonicalUrlsSet] of urlsByPublisher.entries()) {
    const canonicalUrls = Array.from(canonicalUrlsSet);
    const { data: articleRows, error: articleError } = await supabase
      .from("articles")
      .select("publisher_id,canonical_url,body_text")
      .eq("publisher_id", publisherId)
      .in("canonical_url", canonicalUrls);

    if (articleError) {
      throw new Error(articleError.message);
    }

    for (const row of articleRows ?? []) {
      if (!row.body_text) continue;
      articleTextByKey.set(
        `${row.publisher_id}::${row.canonical_url}`,
        row.body_text,
      );
    }
  }

  const maxPublishedAtByCluster = new Map<string, string | null>();
  for (const cluster of selectedClusters) {
    const clusterPublishedAt = sources
      .filter((s) => s.cluster_id === cluster.id)
      .map((s) => s.published_at)
      .filter((v): v is string => Boolean(v))
      .sort((a, b) => +new Date(b) - +new Date(a))[0];

    maxPublishedAtByCluster.set(cluster.id, clusterPublishedAt ?? null);
  }

  const sortedClusters = selectedClusters.slice().sort((a, b) => {
    if (b.source_count !== a.source_count)
      return b.source_count - a.source_count;

    const aMax = maxPublishedAtByCluster.get(a.id) ?? null;
    const bMax = maxPublishedAtByCluster.get(b.id) ?? null;

    if (aMax && bMax) return +new Date(bMax) - +new Date(aMax); // newest first
    if (aMax && !bMax) return -1;
    if (!aMax && bMax) return 1;
    return +new Date(a.created_at) - +new Date(b.created_at); // stable fallback
  });

  const generatedStoryMarkdown: string[] = [];
  const nowMs = Date.now();

  for (const cluster of sortedClusters) {
    const clusterSources = sources
      .filter((s) => s.cluster_id === cluster.id)
      .slice()
      .sort((a, b) => {
        if (a.published_at && b.published_at) {
          return +new Date(b.published_at) - +new Date(a.published_at);
        }
        if (a.published_at && !b.published_at) return -1;
        if (!a.published_at && b.published_at) return 1;
        return a.url.localeCompare(b.url);
      });
    const latestClusterSourceTime = clusterSources.find(
      (source) => source.published_at,
    )?.published_at;
    const latestHoursAgo = toHoursAgo(latestClusterSourceTime ?? null, nowMs);

    const sourceTexts: string[] = [];
    for (const source of clusterSources) {
      const key = `${source.publisher_id}::${source.canonical_url}`;
      const bodyText = articleTextByKey.get(key);
      if (!bodyText) continue;

      sourceTexts.push(
        [
          `Source URL: ${source.url}`,
          `Source: ${source.publishers?.name ?? source.publisher_id}`,
          source.title ? `Title hint: ${source.title}` : null,
          source.published_at
            ? `Published at: ${new Date(source.published_at).toISOString()}`
            : null,
          "Full text:",
          bodyText,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    if (sourceTexts.length === 0) {
      throw new Error(
        `No extracted article text available for cluster ${cluster.id}`,
      );
    }

    const prompt = [
      "You write a single news brief paragraph in Markdown (~600 characters).",
      "The brief is for a story made of multiple sources.",
      "Instructions:",
      "1) Output exactly one Markdown paragraph (no headings, no lists).",
      "2) Always start with an introductory phrase in bold (first characters must be bold).",
      "3) First sentence must state the latest concrete development right now.",
      "4) Keep historical context concise and only as support for the latest update.",
      "5) If story spans multiple days, emphasize what changed recently vs prior coverage.",
      "6) Avoid recap-heavy phrasing and avoid listing everything that happened.",
      `Story title / topic: ${cluster.title}`,
      cluster.selection_reason
        ? `Why this story was selected: ${cluster.selection_reason}`
        : null,
      latestClusterSourceTime
        ? `Most recent source timestamp: ${new Date(latestClusterSourceTime).toISOString()}`
        : null,
      latestHoursAgo !== null
        ? `Most recent source is approximately ${latestHoursAgo} hours old.`
        : null,
      "Relevant sources (full texts), each delimited by ---:",
      sourceTexts.map((t) => `---\n${t}\n---`).join("\n"),
      "Write the paragraph now.",
    ]
      .filter(Boolean)
      .join("\n");

    const generated = await generateGeminiJson(prompt, briefParagraphSchema, {
      model: RUN_BRIEF_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: briefParagraphResponseJsonSchema,
      },
    });

    const cleaned = ensureStartsWithIntroBold(
      replaceNewlinesWithSpaces(generated.markdown),
    );
    generatedStoryMarkdown.push(cleaned);
    console.log(
      `[worker:runs] ${new Date().toISOString()} [run:${runId}] brief: cluster paragraph ok`,
      {
        clusterId: cluster.id,
        title: cluster.title,
        rawMarkdownChars: generated.markdown.length,
        cleanedMarkdownChars: cleaned.length,
        cleanedPreview: cleaned.slice(0, 280),
      },
    );
  }

  const { data: briefRow, error: briefInsertError } = await supabase
    .from("briefs")
    .insert({
      title: "Parrafos brief",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (briefInsertError) {
    throw new Error(briefInsertError.message);
  }
  if (!briefRow?.id) {
    throw new Error("Unable to create brief record");
  }

  const storyInsertRows = generatedStoryMarkdown.map((markdown, idx) => ({
    brief_id: briefRow.id,
    position: idx + 1,
    markdown,
  }));

  const { error: storiesInsertError } = await supabase
    .from("stories")
    .insert(storyInsertRows);

  if (storiesInsertError) {
    throw new Error(storiesInsertError.message);
  }

  console.log(
    `[worker:runs] ${new Date().toISOString()} [run:${runId}] brief: published`,
    {
      briefId: briefRow.id,
      storyCount: generatedStoryMarkdown.length,
    },
  );
}

export async function retryBriefGenerationForFailedRun(
  runId: string,
): Promise<void> {
  const payload = await getRunDetailPayload(runId);
  if (!payload) {
    throw new Error("Run not found");
  }
  if (payload.run.status !== "failed") {
    throw new Error("Only failed runs can retry brief generation");
  }
  if (!canRetryBriefGeneration(payload)) {
    throw new Error(
      "Brief retry needs all publishers completed, selected story clusters, and extracted article text for each selected story.",
    );
  }

  const publishAttempt = await startRunStage(runId, "publish_brief");
  await appendRunEvent({
    runId,
    stage: "publish_brief",
    eventType: "retry_stage_started",
    message: "Retry brief generation started",
  });
  await createAndPublishBriefForRun(runId);
  await completeRunStage(runId, "publish_brief", publishAttempt);
  await appendRunEvent({
    runId,
    stage: "publish_brief",
    eventType: "retry_stage_completed",
    message: "Retry brief generation completed",
  });

  await updateRunProgress(runId, {
    status: "completed",
    ended_at: new Date().toISOString(),
    error_message: null,
    metadata: payload.metadata,
  });
}

function findMetadataArticleProgress(
  metadata: RunMetadata,
  source: {
    publisher_id: string;
    canonical_url: string;
    url: string;
  },
) {
  return metadata.articles.find(
    (entry) =>
      entry.publisher_id === source.publisher_id &&
      (entry.canonical_url === source.canonical_url ||
        entry.url === source.url ||
        entry.url === source.canonical_url),
  );
}

export async function retryFailedExtractionsForFailedRun(
  runId: string,
): Promise<RetryFailedExtractionsResult> {
  const payload = await getRunDetailPayload(runId);
  if (!payload) {
    throw new Error("Run not found");
  }
  if (payload.run.status !== "failed") {
    throw new Error("Only failed runs can retry failed extractions");
  }

  const selectedSources = payload.clusters
    .filter((cluster) => cluster.status === "selected")
    .flatMap((cluster) => cluster.sources);
  if (selectedSources.length === 0) {
    throw new Error(
      "No selected story-cluster sources are available to retry extraction for this run.",
    );
  }

  const sourceByKey = new Map<
    string,
    (typeof selectedSources)[number]
  >();
  for (const source of selectedSources) {
    sourceByKey.set(`${source.publisher_id}::${source.canonical_url}`, source);
  }

  const bodyKeySet = new Set<string>(payload.briefArticleBodyKeys ?? []);
  const metadata = payload.metadata;
  const candidatesToRetry = Array.from(sourceByKey.values()).filter(
    (source) =>
      !bodyKeySet.has(`${source.publisher_id}::${source.canonical_url}`),
  );
  if (candidatesToRetry.length === 0) {
    throw new Error(
      "All selected story sources already have usable article body text.",
    );
  }

  const supabase = createSupabaseServiceClient();
  let succeededCount = 0;
  let failedCount = 0;
  const extractAttempt = await startRunStage(runId, "extract_bodies");
  await appendRunEvent({
    runId,
    stage: "extract_bodies",
    eventType: "retry_stage_started",
    message: "Retry extraction stage started",
  });

  logRun(runId, "retryFailedExtractions: starting", {
    selectedSources: selectedSources.length,
    candidatesToRetry: candidatesToRetry.length,
  });

  await updateRunProgress(runId, {
    error_message: null,
    metadata,
  });

  for (const source of candidatesToRetry) {
    const articleProgress = findMetadataArticleProgress(metadata, source);
    if (articleProgress) {
      articleProgress.status = "fetching";
      articleProgress.error_message = null;
      await updateRunProgress(runId, { metadata });
    }

    try {
      const articleRes = await fetchHtmlWithRetries(source.url, { retries: 0 });
      const cleanedArticleText = cleanTextForLLM(articleRes.html);
      const details = await extractArticleBodyText(
        articleRes.finalUrl,
        cleanedArticleText,
        source.title,
      );

      if (articleProgress) {
        articleProgress.canonical_url = source.canonical_url;
        articleProgress.title = source.title;
        articleProgress.published_at = source.published_at;
        articleProgress.status = "extracted";
        articleProgress.error_message = null;
        await updateRunProgress(runId, { metadata });
      }

      const { error: upsertError } = await supabase.from("articles").upsert(
        {
          publisher_id: source.publisher_id,
          run_id: runId,
          canonical_url: source.canonical_url,
          title: source.title,
          body_text: details.body_text,
          published_at: source.published_at,
          source_url: articleRes.finalUrl,
          extraction_model: RUN_EXTRACT_MODEL,
          clustering_model: RUN_CLUSTER_MODEL,
          relevance_selection_model: RUN_RELEVANCE_MODEL,
          metadata: {
            source_url: articleRes.finalUrl,
            model: RUN_EXTRACT_MODEL,
            clustering_model: RUN_CLUSTER_MODEL,
            relevance_selection_model: RUN_RELEVANCE_MODEL,
          },
        },
        { onConflict: "publisher_id,canonical_url" },
      );
      if (upsertError) {
        throw new Error(upsertError.message);
      }

      succeededCount += 1;
      metadata.articles_upserted += 1;
      const publisherProgress = metadata.publishers.find(
        (entry) => entry.publisher_id === source.publisher_id,
      );
      if (publisherProgress) {
        publisherProgress.articles_upserted += 1;
      }
      if (articleProgress) {
        articleProgress.status = "upserted";
      }
      await updateRunProgress(runId, { metadata });
    } catch (error) {
      failedCount += 1;
      const message =
        errorToMessage(error) ?? "Article extraction retry failed";
      metadata.errors.push({
        publisher_id: source.publisher_id,
        url: source.url,
        message,
      });
      if (articleProgress) {
        articleProgress.status = "failed";
        articleProgress.error_message = message;
      }
      await updateRunProgress(runId, { metadata });
    }
  }
  await completeRunStage(runId, "extract_bodies", extractAttempt);
  await appendRunEvent({
    runId,
    stage: "extract_bodies",
    eventType: "retry_stage_completed",
    message: "Retry extraction stage completed",
  });

  const refreshed = await getRunDetailPayload(runId);
  if (!refreshed) {
    throw new Error("Run not found after extraction retries");
  }

  let briefPublished = false;
  if (canRetryBriefGeneration(refreshed)) {
    const publishAttempt = await startRunStage(runId, "publish_brief");
    await createAndPublishBriefForRun(runId);
    await completeRunStage(runId, "publish_brief", publishAttempt);
    briefPublished = true;
    await updateRunProgress(runId, {
      status: "completed",
      ended_at: new Date().toISOString(),
      error_message: null,
      metadata: refreshed.metadata,
    });
  } else {
    const availability = getBriefRetryAvailability(refreshed);
    const detail =
      availability.kind === "unavailable"
        ? availability.reasons.map((reason) => reason.message).join(" ")
        : availability.kind === "not_applicable" && availability.detail
          ? availability.detail
          : "";
    const errorMessage = detail
      ? `${availability.headline} ${detail}`.trim()
      : availability.headline;
    await updateRunProgress(runId, {
      status: "failed",
      ended_at: new Date().toISOString(),
      error_message: errorMessage,
      metadata: refreshed.metadata,
    });
  }

  return {
    retriedCount: candidatesToRetry.length,
    succeededCount,
    failedCount,
    briefPublished,
  };
}

async function articleExists(
  publisherId: string,
  canonicalUrl: string,
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id")
    .eq("publisher_id", publisherId)
    .eq("canonical_url", canonicalUrl)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return Boolean(data);
}

export async function claimNextPendingRun(): Promise<{ id: string } | null> {
  logRun(null, "claimNextPendingRun: searching pending run");
  const supabase = createSupabaseServiceClient();
  const { data: pending, error: pendingError } = await supabase
    .from("runs")
    .select("id")
    .eq("status", "pending")
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pendingError) {
    throw new Error(pendingError.message);
  }
  if (!pending) return null;

  logRun(null, "claimNextPendingRun: attempting claim", {
    pendingRunId: pending.id,
  });

  const metadata = createInitialRunMetadata();
  const { data: claimed, error: claimError } = await supabase
    .from("runs")
    .update({
      status: "running",
      error_message: null,
      extract_model: metadata.models?.extraction ?? metadata.model,
      cluster_model: metadata.models?.clustering ?? metadata.model,
      relevance_model: metadata.models?.relevance_selection ?? metadata.model,
      publisher_count: metadata.publisher_count,
      publishers_done: metadata.publishers_done,
      articles_found: metadata.articles_found,
      articles_upserted: metadata.articles_upserted,
      clusters_total: metadata.clusters_total,
      clusters_eligible: metadata.clusters_eligible,
      clusters_selected: metadata.clusters_selected,
      sources_selected: metadata.sources_selected,
      current_stage: null,
      stage_attempt: 0,
      last_heartbeat_at: new Date().toISOString(),
      metadata: metadata as Json,
    })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claimError) {
    throw new Error(claimError.message);
  }

  logRun(null, "claimNextPendingRun: claimed", {
    claimedRunId: claimed?.id ?? null,
  });
  return claimed ?? null;
}

export async function processRun(runId: string): Promise<void> {
  logRun(runId, "processRun: starting");
  const supabase = createSupabaseServiceClient();
  const metadata = createInitialRunMetadata();
  const extractConcurrency = getExtractConcurrency();

  logRun(runId, "processRun: extract concurrency resolved", {
    extractConcurrency,
  });

  try {
    const publishers = await listPublishers();
    metadata.publisher_count = publishers.length;

    logRun(runId, "processRun: publishers loaded", {
      publisherCount: publishers.length,
    });

    metadata.publishers = publishers.map((publisher) => ({
      publisher_id: publisher.id,
      publisher_name: publisher.name,
      base_url: publisher.base_url,
      status: "pending",
      articles_found: 0,
      articles_upserted: 0,
      error_message: null,
    }));
    await updateRunProgress(runId, { metadata });
    if (await isRunCancelled(runId)) {
      logRun(runId, "processRun: cancelled before start; exiting early");
      return;
    }

    const discoverStageAttempt = await startRunStage(runId, "discover_candidates");
    await appendRunEvent({
      runId,
      stage: "discover_candidates",
      eventType: "stage_started",
      message: "Discover candidates stage started",
    });

    for (const publisher of publishers) {
      if (await isRunCancelled(runId)) {
        logRun(
          runId,
          "processRun: cancelled during publisher loop; exiting early",
        );
        return;
      }

      const publisherProgress = metadata.publishers.find(
        (entry) => entry.publisher_id === publisher.id,
      );
      try {
        if (publisherProgress) {
          publisherProgress.status = "running";
          publisherProgress.error_message = null;
          await updateRunProgress(runId, { metadata });
        }

        logRun(runId, "publisher crawl: start", {
          publisherId: publisher.id,
          publisherName: publisher.name,
          baseUrl: publisher.base_url,
        });

        const home = await fetchHtmlWithRetries(publisher.base_url, {
          retries: 0,
        });
        const candidates = extractArticleCandidatesFromHomepage(
          publisher.base_url,
          home.html,
        );
        const normalizedUrls = Array.from(
          new Set(
            candidates
              .map((c) => toCanonicalUrl(c.url, publisher.base_url))
              .filter((value): value is string => Boolean(value)),
          ),
        ).slice(0, 15);

        metadata.articles_found += normalizedUrls.length;
        if (publisherProgress) {
          publisherProgress.articles_found = normalizedUrls.length;
        }

        logRun(runId, "publisher crawl: identified candidates", {
          publisherId: publisher.id,
          homeUrl: publisher.base_url,
          candidatesTotal: candidates.length,
          normalizedCandidateCount: normalizedUrls.length,
        });

        metadata.articles.push(
          ...normalizedUrls.map((url) => {
            return {
              publisher_id: publisher.id,
              url,
              canonical_url: null,
              title: null,
              published_at: null,
              status: "identified" as const,
              error_message: null,
            };
          }),
        );
        await updateRunProgress(runId, { metadata });
      } catch (error) {
        if (publisherProgress) {
          publisherProgress.status = "failed";
          publisherProgress.error_message =
            errorToMessage(error) ?? "Publisher crawl failed";
        }
        logRun(runId, "publisher crawl: failed", {
          publisherId: publisher.id,
          publisherName: publisher.name,
          baseUrl: publisher.base_url,
          error: errorToMessage(error),
        });

        metadata.errors.push({
          publisher_id: publisher.id,
          message: errorToMessage(error) ?? "Publisher crawl failed",
        });
      } finally {
        metadata.publishers_done += 1;
        if (publisherProgress && publisherProgress.status === "running") {
          publisherProgress.status = "completed";
        }
        await updateRunProgress(runId, { metadata });

        logRun(runId, "publisher crawl: done", {
          publisherId: publisher.id,
          publisherName: publisher.name,
          status: publisherProgress?.status ?? "unknown",
          publishersDone: metadata.publishers_done,
        });
      }
    }
    await completeRunStage(runId, "discover_candidates", discoverStageAttempt);
    await appendRunEvent({
      runId,
      stage: "discover_candidates",
      eventType: "stage_completed",
      message: "Discover candidates stage completed",
    });

    logRun(runId, "processRun: identification stage complete", {
      articlesFound: metadata.articles_found,
      articlesTotalRecorded: metadata.articles.length,
    });

    logRun(runId, "metadata stage: starting metadata prefetch", {
      candidateCount: metadata.articles.length,
      extractConcurrency,
    });
    const prefetchStageAttempt = await startRunStage(runId, "prefetch_metadata");
    await appendRunEvent({
      runId,
      stage: "prefetch_metadata",
      eventType: "stage_started",
      message: "Metadata prefetch stage started",
    });

    const metadataReadyCandidates = await mapWithConcurrency(
      metadata.articles,
      extractConcurrency,
      async (article): Promise<PrefetchedArticle | null> => {
        if (await isRunCancelled(runId)) {
          return null;
        }
        article.status = "metadata_fetching";
        article.error_message = null;
        await updateRunProgress(runId, { metadata });

        try {
          const articleRes = await fetchHtmlWithRetries(article.url, {
            retries: 0,
          });
          const metadataResult = extractArticleMetadata(
            articleRes.finalUrl,
            articleRes.html,
          );
          if (!metadataResult) {
            article.status = "not_selected_for_extraction";
            article.error_message =
              "Discarded: missing Article/NewsArticle JSON-LD and no article:published_time meta.";
            await updateRunProgress(runId, { metadata });
            logRun(runId, "metadata stage: discarded missing metadata", {
              publisherId: article.publisher_id,
              url: article.url,
              finalUrl: articleRes.finalUrl,
            });
            return null;
          }

          const canonicalUrl =
            toCanonicalUrl(
              metadataResult.canonicalUrl ?? articleRes.finalUrl,
              articleRes.finalUrl,
            ) ?? article.url;
          article.canonical_url = canonicalUrl;
          article.title = metadataResult.title ?? null;
          article.published_at = metadataResult.publishedAt ?? null;
          article.status = "metadata_ready";
          article.error_message = null;
          await updateRunProgress(runId, { metadata });

          const publisher = metadata.publishers.find(
            (entry) => entry.publisher_id === article.publisher_id,
          );
          return {
            publisherId: article.publisher_id,
            publisherName: publisher?.publisher_name ?? article.publisher_id,
            url: article.url,
            canonicalUrl,
            title: article.title,
            description: metadataResult.description,
            publishedAt: article.published_at,
            sourceUrl: articleRes.finalUrl,
            html: articleRes.html,
          };
        } catch (error) {
          article.status = "failed";
          article.error_message =
            errorToMessage(error) ?? "Metadata fetch failed";
          metadata.errors.push({
            publisher_id: article.publisher_id,
            url: article.url,
            message: errorToMessage(error) ?? "Metadata fetch failed",
          });
          await updateRunProgress(runId, { metadata });
          logRun(runId, "metadata stage: failed", {
            publisherId: article.publisher_id,
            url: article.url,
            error: errorToMessage(error),
          });
          return null;
        }
      },
    );

    const prefetchedByCandidateKey = new Map<string, PrefetchedArticle>();
    for (const candidate of metadataReadyCandidates) {
      if (!candidate) continue;
      prefetchedByCandidateKey.set(
        `${candidate.publisherId}::${candidate.url}`,
        candidate,
      );
    }

    const identifiedCandidates: CandidateSource[] = metadataReadyCandidates
      .filter((candidate): candidate is PrefetchedArticle => Boolean(candidate))
      .map((candidate) => ({
        publisherId: candidate.publisherId,
        publisherName: candidate.publisherName,
        url: candidate.url,
        canonicalUrl: candidate.canonicalUrl,
        title: candidate.title,
        description: candidate.description,
        publishedAt: candidate.publishedAt,
      }));

    logRun(runId, "metadata stage: prefetch complete", {
      metadataReady: identifiedCandidates.length,
      discardedOrFailed: metadata.articles.length - identifiedCandidates.length,
    });
    await completeRunStage(runId, "prefetch_metadata", prefetchStageAttempt);
    await appendRunEvent({
      runId,
      stage: "prefetch_metadata",
      eventType: "stage_completed",
      message: "Metadata prefetch stage completed",
    });

    for (const article of metadata.articles) {
      if (article.status === "metadata_ready") {
        article.status = "clustering";
      }
    }
    await updateRunProgress(runId, { metadata });

    logRun(runId, "processRun: clustering stage starting", {
      identifiedCandidates: identifiedCandidates.length,
    });
    const clusterStageAttempt = await startRunStage(runId, "cluster_sources");
    await appendRunEvent({
      runId,
      stage: "cluster_sources",
      eventType: "stage_started",
      message: "Cluster sources stage started",
    });

    const identifiedCandidateKeys = new Set(
      identifiedCandidates.map(
        (candidate) => `${candidate.publisherId}::${candidate.url}`,
      ),
    );
    for (const article of metadata.articles) {
      if (
        article.status === "clustering" &&
        !identifiedCandidateKeys.has(`${article.publisher_id}::${article.url}`)
      ) {
        article.status = "not_selected_for_extraction";
      }
    }
    await updateRunProgress(runId, { metadata });

    const sourceByKey = new Map<string, CandidateSource>();
    for (const candidate of identifiedCandidates) {
      sourceByKey.set(
        sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
        candidate,
      );
    }

    await clearPersistedRunClusters(runId);
    const clusteredStories =
      await clusterCandidatesIntoStories(identifiedCandidates);
    const persistedClusters = await persistClusters(
      runId,
      clusteredStories,
      sourceByKey,
    );
    metadata.clusters_total = persistedClusters.length;

    logRun(runId, "clustering stage: persisted clusters", {
      clustersTotal: persistedClusters.length,
    });

    const sourceKeysInClusters = new Set<string>();
    for (const cluster of persistedClusters) {
      for (const key of cluster.sourceKeys) {
        sourceKeysInClusters.add(key);
      }
    }

    for (const candidate of identifiedCandidates) {
      const progress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === candidate.publisherId &&
          entry.url === candidate.url,
      );
      if (progress) {
        progress.status = sourceKeysInClusters.has(
          sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
        )
          ? "clustered"
          : "not_selected_for_extraction";
      }
    }

    const clustersWithEligibility = await markEligibleClusters(
      runId,
      persistedClusters,
    );
    const eligibleClusters = clustersWithEligibility.filter(
      (cluster) => cluster.status === "eligible",
    );
    metadata.clusters_eligible = eligibleClusters.length;

    logRun(runId, "clustering stage: eligibility applied", {
      clustersEligible: metadata.clusters_eligible,
      clustersTotal: persistedClusters.length,
    });
    await completeRunStage(runId, "cluster_sources", clusterStageAttempt);
    await appendRunEvent({
      runId,
      stage: "cluster_sources",
      eventType: "stage_completed",
      message: "Cluster sources stage completed",
    });

    const selectStageAttempt = await startRunStage(runId, "select_clusters");
    await appendRunEvent({
      runId,
      stage: "select_clusters",
      eventType: "stage_started",
      message: "Select clusters stage started",
    });
    const selectionEvidence = buildClusterSelectionEvidence(
      eligibleClusters,
      sourceByKey,
    );
    const selectionDecisions = await selectRelevantStories(
      eligibleClusters,
      selectionEvidence,
    );
    await updateClusterSelectionStatuses(
      runId,
      eligibleClusters,
      selectionDecisions,
    );
    metadata.clusters_selected = selectionDecisions.selectedClusterIds.size;

    logRun(runId, "clustering stage: selected clusters", {
      clustersSelected: metadata.clusters_selected,
    });
    await completeRunStage(runId, "select_clusters", selectStageAttempt);
    await appendRunEvent({
      runId,
      stage: "select_clusters",
      eventType: "stage_completed",
      message: "Select clusters stage completed",
    });

    const selectedCandidates: CandidateSource[] = [];
    const selectedSourceKeys = new Set<string>();
    for (const cluster of clustersWithEligibility) {
      if (!selectionDecisions.selectedClusterIds.has(cluster.id)) continue;
      for (const key of cluster.sourceKeys) {
        selectedSourceKeys.add(key);
        const source = sourceByKey.get(key);
        if (source) {
          selectedCandidates.push(source);
        }
      }
    }
    metadata.sources_selected = selectedSourceKeys.size;

    logRun(runId, "selection stage: candidates selected for extraction", {
      sourcesSelected: metadata.sources_selected,
      selectedCandidatesCount: selectedCandidates.length,
    });

    for (const candidate of identifiedCandidates) {
      const progress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === candidate.publisherId &&
          entry.url === candidate.url,
      );
      if (progress) {
        progress.status = selectedSourceKeys.has(
          sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
        )
          ? "selected_for_extraction"
          : "not_selected_for_extraction";
      }
    }
    await updateRunProgress(runId, { metadata });

    logRun(runId, "extraction stage: checking existing articles", {
      candidatesToCheck: selectedCandidates.length,
    });
    const extractStageAttempt = await startRunStage(runId, "extract_bodies");
    await appendRunEvent({
      runId,
      stage: "extract_bodies",
      eventType: "stage_started",
      message: "Extract bodies stage started",
    });

    const candidatesToExtract: CandidateSource[] = [];
    for (const candidate of selectedCandidates) {
      if (await isRunCancelled(runId)) {
        return;
      }
      const progress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === candidate.publisherId &&
          entry.url === candidate.url,
      );
      try {
        const exists = await articleExists(
          candidate.publisherId,
          candidate.canonicalUrl,
        );
        if (exists) {
          if (progress) {
            progress.status = "skipped_existing";
            progress.error_message = null;
          }
          logRun(runId, "extraction stage: skipping existing article", {
            publisherId: candidate.publisherId,
            url: candidate.url,
            canonicalUrl: candidate.canonicalUrl,
          });
        } else {
          candidatesToExtract.push(candidate);
          logRun(runId, "extraction stage: queued for extraction", {
            publisherId: candidate.publisherId,
            url: candidate.url,
            canonicalUrl: candidate.canonicalUrl,
          });
        }
      } catch (error) {
        if (progress) {
          progress.status = "failed";
          progress.error_message =
            errorToMessage(error) ?? "Existing article check failed";
        }
        logRun(runId, "extraction stage: existing check failed", {
          publisherId: candidate.publisherId,
          url: candidate.url,
          canonicalUrl: candidate.canonicalUrl,
          error: errorToMessage(error),
        });

        metadata.errors.push({
          publisher_id: candidate.publisherId,
          url: candidate.url,
          message: errorToMessage(error) ?? "Existing article check failed",
        });
      }
      await updateRunProgress(runId, { metadata });
    }

    logRun(runId, "extraction stage: starting article fetch+parse", {
      candidatesToExtract: candidatesToExtract.length,
      extractConcurrency,
    });

    const extractedArticles: Array<ExtractedArticle | null> = [];
    for (const candidate of candidatesToExtract) {
      if (await isRunCancelled(runId)) {
        break;
      }
      const articleProgress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === candidate.publisherId &&
          entry.url === candidate.url,
      );
      if (articleProgress) {
        articleProgress.status = "fetching";
        articleProgress.error_message = null;
        await updateRunProgress(runId, { metadata });
      }

      logRun(runId, "article extraction: start", {
        publisherId: candidate.publisherId,
        url: candidate.url,
        canonicalUrl: candidate.canonicalUrl,
      });

      try {
        const prefetched = prefetchedByCandidateKey.get(
          `${candidate.publisherId}::${candidate.url}`,
        );
        const articleRes = prefetched
          ? {
              finalUrl: prefetched.sourceUrl,
              html: prefetched.html,
            }
          : await fetchHtmlWithRetries(candidate.url, { retries: 0 });
        const cleanedArticleText = cleanTextForLLM(articleRes.html);
        const details = await extractArticleBodyText(
          articleRes.finalUrl,
          cleanedArticleText,
          candidate.title,
        );
        if (articleProgress) {
          articleProgress.canonical_url = candidate.canonicalUrl;
          articleProgress.title = candidate.title;
          articleProgress.published_at = candidate.publishedAt;
          articleProgress.status = "extracted";
          await updateRunProgress(runId, { metadata });
        }

        logRun(runId, "article extraction: success", {
          publisherId: candidate.publisherId,
          sourceUrl: articleRes.finalUrl,
          canonicalUrl: candidate.canonicalUrl,
          bodyChars: details.body_text?.length ?? null,
        });

        extractedArticles.push({
          ...candidate,
          sourceUrl: articleRes.finalUrl,
          canonicalUrl: candidate.canonicalUrl,
          title: candidate.title,
          bodyText: details.body_text,
          publishedAt: candidate.publishedAt,
        });
      } catch (error) {
        if (articleProgress) {
          articleProgress.status = "failed";
          articleProgress.error_message =
            errorToMessage(error) ?? "Article extraction failed";
        }

        logRun(runId, "article extraction: failed", {
          publisherId: candidate.publisherId,
          url: candidate.url,
          canonicalUrl: candidate.canonicalUrl,
          error: errorToMessage(error),
        });

        metadata.errors.push({
          publisher_id: candidate.publisherId,
          url: candidate.url,
          message: errorToMessage(error) ?? "Article extraction failed",
        });
        await updateRunProgress(runId, { metadata });
        extractedArticles.push(null);
      }
    }

    logRun(runId, "extraction stage: fetch+parse complete", {
      extractedArticlesTotal: extractedArticles.length,
      extractedArticlesNonNull: extractedArticles.filter(Boolean).length,
    });
    await completeRunStage(runId, "extract_bodies", extractStageAttempt);
    await appendRunEvent({
      runId,
      stage: "extract_bodies",
      eventType: "stage_completed",
      message: "Extract bodies stage completed",
    });

    const upsertStageAttempt = await startRunStage(runId, "upsert_articles");
    await appendRunEvent({
      runId,
      stage: "upsert_articles",
      eventType: "stage_started",
      message: "Upsert articles stage started",
    });
    for (const article of extractedArticles) {
      if (await isRunCancelled(runId)) {
        return;
      }
      if (!article) continue;
      try {
        logRun(runId, "article upsert: start", {
          publisherId: article.publisherId,
          canonicalUrl: article.canonicalUrl,
        });

        const { error: upsertError } = await supabase.from("articles").upsert(
          {
            publisher_id: article.publisherId,
            run_id: runId,
            canonical_url: article.canonicalUrl,
            title: article.title,
            body_text: article.bodyText,
            published_at: article.publishedAt,
            source_url: article.sourceUrl,
            extraction_model: RUN_EXTRACT_MODEL,
            clustering_model: RUN_CLUSTER_MODEL,
            relevance_selection_model: RUN_RELEVANCE_MODEL,
            metadata: {
              source_url: article.sourceUrl,
              model: RUN_EXTRACT_MODEL,
              clustering_model: RUN_CLUSTER_MODEL,
              relevance_selection_model: RUN_RELEVANCE_MODEL,
            },
          },
          { onConflict: "publisher_id,canonical_url" },
        );
        if (upsertError) {
          throw new Error(upsertError.message);
        }
        metadata.articles_upserted += 1;
        const publisherProgress = metadata.publishers.find(
          (entry) => entry.publisher_id === article.publisherId,
        );
        if (publisherProgress) {
          publisherProgress.articles_upserted += 1;
        }
        const articleProgress = metadata.articles.find(
          (entry) =>
            entry.publisher_id === article.publisherId &&
            (entry.url === article.canonicalUrl ||
              entry.url === article.sourceUrl ||
              entry.canonical_url === article.canonicalUrl),
        );
        if (articleProgress) {
          articleProgress.status = "upserted";
        }
        await updateRunProgress(runId, { metadata });

        logRun(runId, "article upsert: success", {
          publisherId: article.publisherId,
          canonicalUrl: article.canonicalUrl,
          articlesUpserted: metadata.articles_upserted,
        });
      } catch (error) {
        const articleProgress = metadata.articles.find(
          (entry) =>
            entry.publisher_id === article.publisherId &&
            (entry.url === article.canonicalUrl ||
              entry.url === article.sourceUrl ||
              entry.canonical_url === article.canonicalUrl),
        );
        if (articleProgress) {
          articleProgress.status = "failed";
          articleProgress.error_message =
            errorToMessage(error) ?? "Article upsert failed";
        }
        metadata.errors.push({
          publisher_id: article.publisherId,
          url: article.sourceUrl,
          message: errorToMessage(error) ?? "Article upsert failed",
        });
        await updateRunProgress(runId, { metadata });

        logRun(runId, "article upsert: failed", {
          publisherId: article.publisherId,
          canonicalUrl: article.canonicalUrl,
          error: errorToMessage(error),
        });
      }
    }
    await completeRunStage(runId, "upsert_articles", upsertStageAttempt);
    await appendRunEvent({
      runId,
      stage: "upsert_articles",
      eventType: "stage_completed",
      message: "Upsert articles stage completed",
    });

    if (await isRunCancelled(runId)) {
      logRun(runId, "processRun: cancelled after upserts; exiting early");
      return;
    }

    logRun(runId, "publishing brief: start");
    const publishStageAttempt = await startRunStage(runId, "publish_brief");
    await appendRunEvent({
      runId,
      stage: "publish_brief",
      eventType: "stage_started",
      message: "Publish brief stage started",
    });
    await createAndPublishBriefForRun(runId);
    await completeRunStage(runId, "publish_brief", publishStageAttempt);
    await appendRunEvent({
      runId,
      stage: "publish_brief",
      eventType: "stage_completed",
      message: "Publish brief stage completed",
    });
    logRun(runId, "publishing brief: complete");

    await updateRunProgress(runId, {
      status: "completed",
      ended_at: new Date().toISOString(),
      metadata,
    });
    logRun(runId, "processRun: completed", {
      articlesUpserted: metadata.articles_upserted,
      clustersSelected: metadata.clusters_selected,
      sourcesSelected: metadata.sources_selected,
    });
  } catch (error) {
    logRun(runId, "processRun: fatal error", { error: errorToMessage(error) });
    await updateRunProgress(runId, {
      status: "failed",
      ended_at: new Date().toISOString(),
      error_message: errorToMessage(error) ?? "Run failed",
      metadata,
    });
  }
}
