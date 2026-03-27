import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import type { ProcessRunContext } from "@/lib/runs/process/context";
import {
  clearPersistedRunClusters,
  clusterCandidatesIntoStories,
  markEligibleClusters,
  sourceKeyFor,
  updateClusterSelectionStatuses,
  updateRunProgress,
  persistClusters,
  selectRelevantStories,
} from "@/lib/runs/process/shared";

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
