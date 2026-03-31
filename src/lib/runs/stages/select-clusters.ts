import { generateGeminiJson } from "@/lib/gemini/generate";
import {
  parseRunSelectPrimaryMax,
  parseRunSelectSecondaryMax,
  RUN_RECENCY_WINDOW_MEDIUM_HOURS,
  RUN_RECENCY_WINDOW_SHORT_HOURS,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import {
  createTieredRelevantStoriesResponseJsonSchema,
  createTieredRelevantStoriesSchema,
} from "@/lib/runs/console/pipeline-constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import type {
  CandidateSource,
  ClusterDraft,
} from "@/lib/runs/console/types";
import { toHoursAgo, toRecentCount, toSingleLine } from "@/lib/runs/console/utils";

export type SelectedClusterTiers = {
  primaryClusters: ClusterDraft[];
  secondaryClusters: ClusterDraft[];
};

export async function selectClusters(input: {
  clusters: ClusterDraft[];
  sourceByKey: Map<string, CandidateSource>;
}): Promise<SelectedClusterTiers> {
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
  const maxPrimary = parseRunSelectPrimaryMax();
  const maxSecondary = parseRunSelectSecondaryMax();
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
      "Choose cluster tiers for extraction prioritization.",
      `Return at most ${maxPrimary} rows in primary_clusters using positions 1..${maxPrimary}.`,
      `Return at most ${maxSecondary} rows in secondary_clusters using positions 1..${maxSecondary}.`,
      "Return any remaining clusters in diffuse_clusters (uncapped, no position needed).",
      "Each story includes source_count (number of articles/sources in that cluster); use it when assigning tiers.",
      "Primary clusters MUST have source_count >= 3.",
      "Every eligible cluster_id must appear in exactly one bucket: primary_clusters, secondary_clusters, or diffuse_clusters.",
      "A diffuse cluster means the cluster does not clearly map to one concrete specific news event.",
      "Prioritize public impact and broad relevance.",
      "Notable passings (deaths of widely recognized public figures—national or international leaders, major artists or cultural figures, celebrated scientists, athletes of historic stature, or others with clear broad public significance) are strong primary_cluster material when the cluster clearly concerns that person's death and multi-source coverage supports it.",
      `Prioritize clusters with concrete updates in the last ${RUN_RECENCY_WINDOW_SHORT_HOURS}-${RUN_RECENCY_WINDOW_MEDIUM_HOURS} hours.`,
      "Prefer newest developments over stale recap.",
      "Deprioritize repetitive, low-consequence, or evergreen items when stronger updates exist.",
      "Ignore routine day-to-day crime coverage unless it has extraordinary national or institutional impact.",
      "Sports stories are only acceptable when they are clearly history-making (for example, landmark championship wins, unprecedented records, or major structural milestones).",
      "For primary_clusters and secondary_clusters, include selection_reason and integer position.",
      "Stories:",
      JSON.stringify(evidence),
    ].join("\n"),
    createTieredRelevantStoriesSchema(maxPrimary, maxSecondary),
    {
      model: RUN_RELEVANCE_MODEL,
      nativeStructuredOutput: {
        responseJsonSchema: createTieredRelevantStoriesResponseJsonSchema(
          maxPrimary,
          maxSecondary,
        ),
      },
    },
  );
  logLine("select_clusters: model response received", {
    primaryReturned: generated.primary_clusters.length,
    secondaryReturned: generated.secondary_clusters.length,
    diffuseReturned: generated.diffuse_clusters.length,
  });

  const primarySelectionById = new Map<string, { reason: string; position: number }>();
  const primaryRows = generated.primary_clusters
    .filter((row) => Number.isInteger(row.position) && row.position >= 1)
    .slice()
    .sort((a, b) => a.position - b.position || a.cluster_id.localeCompare(b.cluster_id))
    .slice(0, maxPrimary);
  for (const row of primaryRows) {
    if (primarySelectionById.has(row.cluster_id)) continue;
    primarySelectionById.set(row.cluster_id, {
      reason: row.selection_reason.trim(),
      position: row.position,
    });
  }

  const selectedPrimaryWithPosition = clustersForSelection
    .filter((cluster) => primarySelectionById.has(cluster.id))
    .map((cluster) => ({
      cluster: {
        ...cluster,
        selectionReason: primarySelectionById.get(cluster.id)?.reason ?? null,
      },
      position:
        primarySelectionById.get(cluster.id)?.position ?? Number.MAX_SAFE_INTEGER,
    }));
  selectedPrimaryWithPosition.sort(
    (a, b) => a.position - b.position || a.cluster.id.localeCompare(b.cluster.id),
  );
  const primaryClusters = selectedPrimaryWithPosition.map((row) => row.cluster);
  if (primaryClusters.length === 0) {
    throw new Error("Relevance selection returned zero clusters.");
  }

  const secondarySelectionById = new Map<string, { reason: string; position: number }>();
  const secondaryRows = generated.secondary_clusters
    .filter(
      (row) =>
        row.cluster_id.trim().length > 0 &&
        Number.isInteger(row.position) &&
        row.position >= 1,
    )
    .sort((a, b) => a.position - b.position || a.cluster_id.localeCompare(b.cluster_id))
    .slice(0, maxSecondary);
  for (const row of secondaryRows) {
    if (secondarySelectionById.has(row.cluster_id)) continue;
    secondarySelectionById.set(row.cluster_id, {
      reason: row.selection_reason.trim(),
      position: row.position,
    });
  }
  const secondarySelectedWithPosition = clustersForSelection
    .filter((cluster) => secondarySelectionById.has(cluster.id))
    .map((cluster) => ({
      cluster: {
        ...cluster,
        selectionReason: secondarySelectionById.get(cluster.id)?.reason ?? null,
      },
      position:
        secondarySelectionById.get(cluster.id)?.position ?? Number.MAX_SAFE_INTEGER,
    }));
  secondarySelectedWithPosition.sort(
    (a, b) => a.position - b.position || a.cluster.id.localeCompare(b.cluster.id),
  );
  const secondaryClusters = secondarySelectedWithPosition.map((row) => row.cluster);

  const secondaryIds = secondaryClusters.map((row) => row.id);
  const diffuseIds = generated.diffuse_clusters
    .filter((row) => row.cluster_id.trim().length > 0)
    .map((row) => row.cluster_id);

  logLine("select_clusters: done", {
    selectedPrimaryClusters: primaryClusters.length,
    selectedPrimarySources: primaryClusters.reduce(
      (acc, row) => acc + row.sourceKeys.length,
      0,
    ),
    secondaryClusters: secondaryClusters.length,
    diffuseClusters: diffuseIds.length,
    secondaryClusterIds: secondaryIds.join(","),
    diffuseClusterIds: diffuseIds.join(","),
  });
  return { primaryClusters, secondaryClusters };
}
