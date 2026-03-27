import {
  RUN_BRIEF_MODEL,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { divider, logLine } from "@/lib/runs/console/logging";
import {
  clusterSources,
  composeBriefSections,
  createConsoleRunRecord,
  discoverCandidates,
  extractBodies,
  finalizeConsoleRunRecord,
  generateStorySummaries,
  persistBriefOutput,
  prefetchMetadata,
  selectClusters,
  upsertExtractedArticles,
} from "@/lib/runs/stages";

export async function runConsoleWorkflow() {
  const startedAt = Date.now();
  let runId: string | null = null;
  logLine("console workflow started", {
    extractModel: RUN_EXTRACT_MODEL,
    clusterModel: RUN_CLUSTER_MODEL,
    relevanceModel: RUN_RELEVANCE_MODEL,
    briefModel: RUN_BRIEF_MODEL,
  });

  try {
    const discovered = await discoverCandidates();
    if (discovered.length === 0) {
      throw new Error("No candidates discovered.");
    }

    const extractConcurrencyRaw = Number.parseInt(
      process.env.RUN_EXTRACT_CONCURRENCY ?? "5",
      10,
    );
    const extractConcurrency =
      Number.isFinite(extractConcurrencyRaw) && extractConcurrencyRaw > 0
        ? Math.min(extractConcurrencyRaw, 20)
        : 5;

    runId = await createConsoleRunRecord();
    logLine("created console run record", { runId });

    const { prefetchedByKey, metadataReadyRecent } = await prefetchMetadata({
      discovered,
      concurrency: extractConcurrency,
    });
    if (metadataReadyRecent.length === 0) {
      throw new Error("No metadata-ready recent candidates remain after prefetch.");
    }

    const { clusters, sourceByKey } = await clusterSources(metadataReadyRecent);
    if (clusters.length === 0) {
      throw new Error("No eligible clusters were created.");
    }

    const selectedClusters = await selectClusters({ clusters, sourceByKey });
    const { extracted, skippedExisting } = await extractBodies({
      selectedClusters,
      sourceByKey,
      prefetchedByKey,
    });
    await upsertExtractedArticles(extracted, runId);

    const storySummaries = await generateStorySummaries({
      selectedClusters,
      sourceByKey,
    });
    const briefSections = await composeBriefSections(storySummaries);
    const published = await persistBriefOutput({
      selectedClusters,
      sourceByKey,
      storySummaries,
      briefSections,
    });

    const elapsedMs = Date.now() - startedAt;
    await finalizeConsoleRunRecord({ runId, status: "completed" });
    divider("completed");
    logLine("console workflow finished successfully", {
      runId,
      briefId: published.briefId,
      discovered: discovered.length,
      metadataReadyRecent: metadataReadyRecent.length,
      clusters: clusters.length,
      selectedClusters: selectedClusters.length,
      selectedSources: selectedClusters.reduce(
        (acc, row) => acc + row.sourceKeys.length,
        0,
      ),
      extractedNew: extracted.length,
      skippedExisting,
      elapsedSeconds: Math.round(elapsedMs / 1000),
    });
  } catch (error) {
    if (runId) {
      await finalizeConsoleRunRecord({
        runId,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}
