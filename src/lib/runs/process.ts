import { claimNextPendingRun } from "@/lib/runs/process/claim";
import { createProcessRunContext } from "@/lib/runs/process/context";
import {
  retryBriefGenerationForFailedRun,
  retryFailedExtractionsForFailedRun,
} from "@/lib/runs/process/retry-ops";
import {
  errorToMessage,
  getExtractConcurrency,
  isRunCancelled,
  logRun,
  updateRunProgress,
} from "@/lib/runs/process/shared";
import { runClusterAndSelectStages } from "@/lib/runs/process/stage-cluster-and-select";
import { runComposeBriefParagraphsStage } from "@/lib/runs/process/stage-compose-brief-paragraphs";
import { runDiscoverCandidatesStage } from "@/lib/runs/process/stage-discover-candidates";
import { runExtractBodiesStage } from "@/lib/runs/process/stage-extract-bodies";
import { runGenerateStorySummariesStage } from "@/lib/runs/process/stage-generate-story-summaries";
import { runPersistBriefOutputStage } from "@/lib/runs/process/stage-persist-brief-output";
import { runPrefetchMetadataStage } from "@/lib/runs/process/stage-prefetch-metadata";
import { runUpsertArticlesStage } from "@/lib/runs/process/stage-upsert-articles";
import { createInitialRunMetadata } from "@/lib/runs/progress";

export {
  claimNextPendingRun,
  retryBriefGenerationForFailedRun,
  retryFailedExtractionsForFailedRun,
};

export async function processRun(runId: string): Promise<void> {
  logRun(runId, "processRun: starting");
  const metadata = createInitialRunMetadata();
  const extractConcurrency = getExtractConcurrency();
  const context = createProcessRunContext(runId, metadata, extractConcurrency);

  logRun(runId, "processRun: extract concurrency resolved", {
    extractConcurrency,
  });

  try {
    await runDiscoverCandidatesStage(context);
    if (await isRunCancelled(runId)) return;
    await runPrefetchMetadataStage(context);
    if (await isRunCancelled(runId)) return;
    await runClusterAndSelectStages(context);
    if (await isRunCancelled(runId)) return;
    await runExtractBodiesStage(context);
    if (await isRunCancelled(runId)) return;
    await runUpsertArticlesStage(context);
    if (!(await runGenerateStorySummariesStage(context))) return;
    if (!(await runComposeBriefParagraphsStage(context))) return;
    if (!(await runPersistBriefOutputStage(context))) return;

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
