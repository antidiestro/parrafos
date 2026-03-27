import { createHash } from "node:crypto";
import { z } from "zod";
import type { Json } from "@/database.types";
import { extractArticleMetadata } from "@/lib/extract/article-candidates";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { cleanTextForLLM } from "@/lib/extract/html";
import { generateGeminiJson } from "@/lib/gemini/generate";
import {
  RUN_BRIEF_MODEL,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RECENCY_WINDOW_MEDIUM_HOURS,
  RUN_RECENCY_WINDOW_SHORT_HOURS,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { persistRunProgressSnapshot } from "@/lib/runs/persistence/progress-repo";
import type { RunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const MIN_SOURCES_PER_CLUSTER = 3;
const TARGET_CLUSTER_COUNT = 10;
const MAX_RELEVANT_STORIES = 6;

export type CandidateSource = {
  publisherId: string;
  publisherName: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;
};

export type ExtractedArticle = CandidateSource & {
  sourceUrl: string;
  bodyText: string;
};

export type PrefetchedArticle = CandidateSource & {
  sourceUrl: string;
  html: string;
};

export type RetryFailedExtractionsResult = {
  retriedCount: number;
  succeededCount: number;
  failedCount: number;
  briefPublished: boolean;
};

export type PersistedCluster = {
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

export type SelectionDecision = {
  selectedClusterIds: Set<string>;
  reasonsByClusterId: Map<string, string>;
  latestDevelopmentByClusterId: Map<string, string>;
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

function ensureStartsWithIntroBold(markdown: string): string {
  const trimmed = markdown.trim();
  if (/^\*\*.+?\*\*/.test(trimmed)) return trimmed;
  return `**Top update:** ${trimmed}`;
}

export function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function logRun(
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

export function toCanonicalUrl(raw: string, baseUrl: string): string | null {
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

export function getExtractConcurrency(): number {
  const raw = process.env.RUN_EXTRACT_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 5;
  }
  return Math.min(parsed, 20);
}

export async function mapWithConcurrency<T, R>(
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

export async function updateRunProgress(
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

export async function isRunCancelled(runId: string): Promise<boolean> {
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

export async function extractArticleBodyText(
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

export function sourceKeyFor(publisherId: string, canonicalUrl: string) {
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

export async function clusterCandidatesIntoStories(
  candidates: CandidateSource[],
) {
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
      if (!availableKeys.has(key)) continue;
      if (usedKeys.has(key)) continue;
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

export async function clearPersistedRunClusters(runId: string) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("run_story_clusters")
    .delete()
    .eq("run_id", runId);
  if (error) throw new Error(error.message);
}

export async function persistClusters(
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

export async function markEligibleClusters(
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

export async function selectRelevantStories(
  clusters: PersistedCluster[],
  sourceByKey: Map<string, CandidateSource>,
): Promise<SelectionDecision> {
  if (clusters.length === 0) {
    return {
      selectedClusterIds: new Set<string>(),
      reasonsByClusterId: new Map<string, string>(),
      latestDevelopmentByClusterId: new Map<string, string>(),
    };
  }
  const nowMs = Date.now();
  const evidenceRows = buildClusterSelectionEvidence(clusters, sourceByKey);
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

export async function updateClusterSelectionStatuses(
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

export async function createAndPublishBriefForRun(runId: string) {
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
    if (articleError) throw new Error(articleError.message);
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
    if (aMax && bMax) return +new Date(bMax) - +new Date(aMax);
    if (aMax && !bMax) return -1;
    if (!aMax && bMax) return 1;
    return +new Date(a.created_at) - +new Date(b.created_at);
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
  if (briefInsertError) throw new Error(briefInsertError.message);
  if (!briefRow?.id) throw new Error("Unable to create brief record");

  const storyInsertRows = generatedStoryMarkdown.map((markdown, idx) => ({
    brief_id: briefRow.id,
    position: idx + 1,
    markdown,
  }));
  const { error: storiesInsertError } = await supabase
    .from("stories")
    .insert(storyInsertRows);
  if (storiesInsertError) throw new Error(storiesInsertError.message);

  console.log(
    `[worker:runs] ${new Date().toISOString()} [run:${runId}] brief: published`,
    {
      briefId: briefRow.id,
      storyCount: generatedStoryMarkdown.length,
    },
  );
}

export async function articleExists(
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
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export function findMetadataArticleProgress(
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

export async function hydrateCandidateFromUrl(
  url: string,
  publisherId: string,
  publisherName: string,
) {
  const articleRes = await fetchHtmlWithRetries(url, { retries: 0 });
  const metadataResult = extractArticleMetadata(
    articleRes.finalUrl,
    articleRes.html,
  );
  return { articleRes, metadataResult, publisherId, publisherName };
}

export {
  cleanTextForLLM,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
};
