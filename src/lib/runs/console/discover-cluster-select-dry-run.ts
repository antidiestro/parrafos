import {
  parseRunSelectPrimaryMax,
  parseRunSelectSecondaryMax,
  RUN_CLUSTER_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import { toSingleLine } from "@/lib/runs/console/utils";
import {
  clusterSources,
  discoverCandidates,
  prefetchMetadata,
  selectClusters,
} from "@/lib/runs/stages";

function prefetchConcurrency(): number {
  const extractConcurrencyRaw = Number.parseInt(
    process.env.RUN_EXTRACT_CONCURRENCY ?? "5",
    10,
  );
  return Number.isFinite(extractConcurrencyRaw) && extractConcurrencyRaw > 0
    ? Math.min(extractConcurrencyRaw, 20)
    : 5;
}

/**
 * Runs discovery → prefetch → clustering → cluster selection with the same
 * stage implementations as the console workflow, without DB writes and without
 * the RUN_MIN_PCT_NEW_CANDIDATES novelty gate.
 */
export async function runDiscoverClusterSelectDryRun() {
  const startedAt = Date.now();
  const selectPrimaryMax = parseRunSelectPrimaryMax();
  const selectSecondaryMax = parseRunSelectSecondaryMax();
  logLine("pipeline dry-run started", {
    cluster: RUN_CLUSTER_MODEL,
    relevance: RUN_RELEVANCE_MODEL,
    selectPrimaryMax,
    selectSecondaryMax,
    note: "prefetch included for production-parity headlines; no DB writes; RUN_MIN_PCT_NEW_CANDIDATES ignored",
  });

  const discovered = await discoverCandidates();
  if (discovered.length === 0) {
    throw new Error("No candidates discovered.");
  }

  const { metadataReadyRecent } = await prefetchMetadata({
    discovered,
    concurrency: prefetchConcurrency(),
  });
  if (metadataReadyRecent.length === 0) {
    throw new Error("No metadata-ready recent candidates remain after prefetch.");
  }

  const { clusters, sourceByKey } = await clusterSources(metadataReadyRecent);
  if (clusters.length === 0) {
    throw new Error("No eligible clusters were created.");
  }

  const selectedClusters = await selectClusters({ clusters, sourceByKey });

  for (const row of selectedClusters) {
    logLine("dry_run: selected_cluster", {
      id: row.id,
      title: toSingleLine(row.title),
      sources: row.sourceKeys.length,
      reason: row.selectionReason ? toSingleLine(row.selectionReason) : null,
    });
  }

  const elapsedMs = Date.now() - startedAt;
  divider("completed");
  logLine("pipeline dry-run finished", {
    discovered: discovered.length,
    metadataReadyRecent: metadataReadyRecent.length,
    clusters: clusters.length,
    selectedClusters: selectedClusters.length,
    selectedSources: selectedClusters.reduce(
      (acc, row) => acc + row.sourceKeys.length,
      0,
    ),
    elapsedSeconds: Math.round(elapsedMs / 1000),
  });
}
