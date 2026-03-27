import { createHash } from "node:crypto";
import { z } from "zod";
import { generateGeminiJson } from "@/lib/gemini/generate";
import {
  RUN_CLUSTER_MODEL,
  RUN_RECENCY_WINDOW_MEDIUM_HOURS,
  RUN_RECENCY_WINDOW_SHORT_HOURS,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import type { ProcessRunContext } from "@/lib/runs/process/context";
import {
  type CandidateSource,
  type PersistedCluster,
  type SelectionDecision,
  updateRunProgress,
} from "@/lib/runs/process/shared";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const MIN_SOURCES_PER_CLUSTER = 3;
const TARGET_CLUSTER_COUNT = 10;
const MAX_RELEVANT_STORIES = 6;

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

function sourceKeyFor(publisherId: string, canonicalUrl: string) {
  const digest = createHash("sha256")
    .update(publisherId)
    .update("\0")
    .update(canonicalUrl)
    .digest("hex")
    .slice(0, 16);
  return `s_${digest}`;
}

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
      throw new Error(clusterError?.message ?? "Unable to persist story cluster");
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

export async function runClusterAndSelectStages(
  context: ProcessRunContext,
): Promise<void> {
  const { runId, metadata, identifiedCandidates } = context;

  for (const article of metadata.articles) {
    if (article.status === "metadata_ready") {
      article.status = "clustering";
    }
  }
  await updateRunProgress(runId, { metadata });

  const identifiedCandidateKeys = new Set(
    identifiedCandidates.map((candidate) => `${candidate.publisherId}::${candidate.url}`),
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

  context.sourceByKey.clear();
  for (const candidate of identifiedCandidates) {
    context.sourceByKey.set(
      sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
      candidate,
    );
  }

  const clusterStageAttempt = await startRunStage(runId, "cluster_sources");
  await appendRunEvent({
    runId,
    stage: "cluster_sources",
    eventType: "stage_started",
    message: "Cluster sources stage started",
  });
  await clearPersistedRunClusters(runId);
  const clusteredStories = await clusterCandidatesIntoStories(identifiedCandidates);
  const persistedClusters = await persistClusters(
    runId,
    clusteredStories,
    context.sourceByKey,
  );
  metadata.clusters_total = persistedClusters.length;

  const sourceKeysInClusters = new Set<string>();
  for (const cluster of persistedClusters) {
    for (const key of cluster.sourceKeys) {
      sourceKeysInClusters.add(key);
    }
  }

  for (const candidate of identifiedCandidates) {
    const progress = metadata.articles.find(
      (entry) =>
        entry.publisher_id === candidate.publisherId && entry.url === candidate.url,
    );
    if (progress) {
      progress.status = sourceKeysInClusters.has(
        sourceKeyFor(candidate.publisherId, candidate.canonicalUrl),
      )
        ? "clustered"
        : "not_selected_for_extraction";
    }
  }

  context.clustersWithEligibility = await markEligibleClusters(runId, persistedClusters);
  const eligibleClusters = context.clustersWithEligibility.filter(
    (cluster) => cluster.status === "eligible",
  );
  metadata.clusters_eligible = eligibleClusters.length;
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
  context.selectionDecisions = await selectRelevantStories(
    eligibleClusters,
    context.sourceByKey,
  );
  await updateClusterSelectionStatuses(
    runId,
    eligibleClusters,
    context.selectionDecisions,
  );
  metadata.clusters_selected = context.selectionDecisions.selectedClusterIds.size;

  context.selectedCandidates = [];
  const selectedSourceKeys = new Set<string>();
  for (const cluster of context.clustersWithEligibility) {
    if (!context.selectionDecisions.selectedClusterIds.has(cluster.id)) continue;
    for (const key of cluster.sourceKeys) {
      selectedSourceKeys.add(key);
      const source = context.sourceByKey.get(key);
      if (source) context.selectedCandidates.push(source);
    }
  }
  metadata.sources_selected = selectedSourceKeys.size;

  for (const candidate of identifiedCandidates) {
    const progress = metadata.articles.find(
      (entry) =>
        entry.publisher_id === candidate.publisherId && entry.url === candidate.url,
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

  await completeRunStage(runId, "select_clusters", selectStageAttempt);
  await appendRunEvent({
    runId,
    stage: "select_clusters",
    eventType: "stage_completed",
    message: "Select clusters stage completed",
  });
}
