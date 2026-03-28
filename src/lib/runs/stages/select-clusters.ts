import { generateGeminiJson } from "@/lib/gemini/generate";
import {
  RUN_RECENCY_WINDOW_MEDIUM_HOURS,
  RUN_RECENCY_WINDOW_SHORT_HOURS,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import {
  MAX_RELEVANT_STORIES,
  relevantStoriesResponseJsonSchema,
  relevantStoriesSchema,
} from "@/lib/runs/console/pipeline-constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import type {
  CandidateSource,
  ClusterDraft,
} from "@/lib/runs/console/types";
import { toHoursAgo, toRecentCount, toSingleLine } from "@/lib/runs/console/utils";

export async function selectClusters(input: {
  clusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
}): Promise<ClusterDraft[]> {
  divider("select_clusters");
  if (input.clusters.length === 0) {
    throw new Error("No eligible clusters available for selection.");
  }

  const clustersForSelection = input.clusters.filter(
    (cluster) => cluster.sourceKeys.length > 1,
  );
  logLine("select_clusters: input prepared", {
    totalClusters: input.clusters.length,
    singletonsExcluded: input.clusters.length - clustersForSelection.length,
    eligibleClusters: clustersForSelection.length,
  });
  if (clustersForSelection.length === 0) {
    throw new Error(
      "No multi-source clusters available for relevance selection (every cluster is a single article).",
    );
  }

  const nowMs = Date.now();
  const evidence = clustersForSelection.map((cluster) => {
    const sources = cluster.sourceKeys
      .map((key) => input.sourceByKey.get(key))
      .filter((value): value is CandidateSource => Boolean(value));
    const latestPublishedAt =
      sources
        .map((source) => source.publishedAt)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => +new Date(b) - +new Date(a))[0] ?? null;
    const earliestPublishedAt =
      sources
        .map((source) => source.publishedAt)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => +new Date(a) - +new Date(b))[0] ?? null;
    const latestHeadlines = sources
      .slice()
      .sort((a, b) => {
        if (a.publishedAt && b.publishedAt) {
          return +new Date(b.publishedAt) - +new Date(a.publishedAt);
        }
        if (a.publishedAt && !b.publishedAt) return -1;
        if (!a.publishedAt && b.publishedAt) return 1;
        return a.url.localeCompare(b.url);
      })
      .map((source) => toSingleLine(source.title))
      .filter((value) => value.length > 0)
      .slice(0, 3);
    const latestDescription =
      sources
        .map((source) => source.description)
        .find((value): value is string => Boolean(value?.trim())) ?? null;

    return {
      cluster_id: cluster.id,
      title: cluster.title,
      source_count: cluster.sourceKeys.length,
      publisher_count: new Set(sources.map((source) => source.publisherId)).size,
      latest_published_at: latestPublishedAt,
      earliest_published_at: earliestPublishedAt,
      latest_hours_ago: toHoursAgo(latestPublishedAt, nowMs),
      sources_last_6h: toRecentCount(
        sources.map((source) => source.publishedAt),
        nowMs,
        RUN_RECENCY_WINDOW_SHORT_HOURS,
      ),
      sources_last_24h: toRecentCount(
        sources.map((source) => source.publishedAt),
        nowMs,
        RUN_RECENCY_WINDOW_MEDIUM_HOURS,
      ),
      latest_headlines: latestHeadlines,
      latest_description: latestDescription,
    };
  });

  const generated = await generateGeminiJson(
    [
      "Choose the most relevant stories for extraction.",
      `Return exactly ${MAX_RELEVANT_STORIES} cluster IDs when there are at least ${MAX_RELEVANT_STORIES} eligible stories.`,
      `If there are fewer than ${MAX_RELEVANT_STORIES} eligible stories, return all eligible cluster IDs.`,
      "Prioritize public impact and broad relevance.",
      `Prioritize clusters with concrete updates in the last ${RUN_RECENCY_WINDOW_SHORT_HOURS}-${RUN_RECENCY_WINDOW_MEDIUM_HOURS} hours.`,
      "Prefer newest developments over stale recap.",
      "Deprioritize repetitive, low-consequence, or evergreen items when stronger updates exist.",
      "Ignore routine day-to-day crime coverage unless it has extraordinary national or institutional impact.",
      "Sports stories are only acceptable when they are clearly history-making (for example, landmark championship wins, unprecedented records, or major structural milestones).",
      "For each selected cluster, return a short selection_reason.",
      "Stories:",
      JSON.stringify(evidence),
    ].join("\n"),
    relevantStoriesSchema,
    {
      model: RUN_RELEVANCE_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: relevantStoriesResponseJsonSchema,
      },
    },
  );
  logLine("select_clusters: model response received", {
    selectedReturned: generated.selected_clusters.length,
  });

  const selectionById = new Map<string, { reason: string }>();
  for (const row of generated.selected_clusters) {
    selectionById.set(row.cluster_id, { reason: row.selection_reason.trim() });
    if (selectionById.size >= MAX_RELEVANT_STORIES) break;
  }

  const selected = clustersForSelection
    .filter((cluster) => selectionById.has(cluster.id))
    .map((cluster) => ({
      ...cluster,
      selectionReason: selectionById.get(cluster.id)?.reason ?? null,
    }));
  if (selected.length === 0) {
    throw new Error("Relevance selection returned zero clusters.");
  }

  logLine("select_clusters: done", {
    selectedClusters: selected.length,
    selectedSources: selected.reduce((acc, row) => acc + row.sourceKeys.length, 0),
  });
  return selected;
}
