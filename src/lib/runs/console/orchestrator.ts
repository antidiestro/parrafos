import {
  parseRunMinPctNewCandidates,
  RUN_BRIEF_MODEL,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { touchLatestPublishedBriefPublishedAt } from "@/lib/data/briefs";
import { divider, logLine } from "@/lib/runs/console/logging";
import {
  clusterSources,
  composeBriefSections,
  createConsoleRunRecord,
  discoverCandidates,
  extractBodies,
  fetchLatestDiscoveryBaselineUrls,
  finalizeConsoleRunRecord,
  generateStorySummaries,
  newCandidateMetrics,
  persistBriefOutput,
  persistDiscoveryCandidates,
  prefetchMetadata,
  selectClusters,
  upsertSecondarySourceMetadata,
  upsertExtractedArticles,
} from "@/lib/runs/stages";

export async function runConsoleWorkflow() {
  const startedAt = Date.now();
  let runId: string | null = null;
  logLine("console workflow started", {
    extract: RUN_EXTRACT_MODEL,
    cluster: RUN_CLUSTER_MODEL,
    relevance: RUN_RELEVANCE_MODEL,
    brief: RUN_BRIEF_MODEL,
  });

  try {
    const minPctNewCandidates = parseRunMinPctNewCandidates();

    runId = await createConsoleRunRecord();
    logLine("created console run record", { runId });

    const discovered = await discoverCandidates();
    const baselineUrls = await fetchLatestDiscoveryBaselineUrls();
    const newVsBaseline = newCandidateMetrics(discovered, baselineUrls);
    if (minPctNewCandidates !== null) {
      logLine("discover_candidates: new_vs_prior_snapshot", {
        ...newVsBaseline,
        minPctNewCandidates,
      });
    }
    if (discovered.length === 0) {
      throw new Error("No candidates discovered.");
    }
    if (
      minPctNewCandidates !== null &&
      newVsBaseline.pctNew < minPctNewCandidates
    ) {
      const touched = await touchLatestPublishedBriefPublishedAt();
      if (!touched) {
        throw new Error(
          `New candidate rate ${newVsBaseline.pctNew}% is below RUN_MIN_PCT_NEW_CANDIDATES (${minPctNewCandidates}%), and no published brief exists to refresh.`,
        );
      }
      const elapsedMsEarly = Date.now() - startedAt;
      await finalizeConsoleRunRecord({ runId, status: "completed" });
      divider("completed");
      logLine(
        "console workflow finished (novelty gate: refreshed latest brief published_at)",
        {
          runId,
          briefId: touched.briefId,
          pctNew: newVsBaseline.pctNew,
          minPctNewCandidates,
          elapsedSeconds: Math.round(elapsedMsEarly / 1000),
        },
      );
      return;
    }

    const extractConcurrencyRaw = Number.parseInt(
      process.env.RUN_EXTRACT_CONCURRENCY ?? "5",
      10,
    );
    const extractConcurrency =
      Number.isFinite(extractConcurrencyRaw) && extractConcurrencyRaw > 0
        ? Math.min(extractConcurrencyRaw, 20)
        : 5;

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

    const { primaryClusters, secondaryClusters } = await selectClusters({
      clusters,
      sourceByKey,
    });
    const { extracted, skippedExisting } = await extractBodies({
      selectedClusters: primaryClusters,
      sourceByKey,
      prefetchedByKey,
    });
    await upsertExtractedArticles(extracted, runId);
    await upsertSecondarySourceMetadata({
      runId,
      secondaryClusters,
      sourceByKey,
    });

    const storySummaries = await generateStorySummaries({
      selectedClusters: primaryClusters,
      sourceByKey,
    });
    const briefSections = await composeBriefSections(storySummaries);
    const published = await persistBriefOutput({
      primaryClusters,
      secondaryClusters,
      sourceByKey,
      storySummaries,
      briefSections,
    });

    const elapsedMs = Date.now() - startedAt;
    try {
      await persistDiscoveryCandidates({ runId, discovered });
    } catch (persistDiscoveryError) {
      logLine("runs: persist discovery candidates failed; brief already published", {
        runId,
        err:
          persistDiscoveryError instanceof Error
            ? persistDiscoveryError.message
            : String(persistDiscoveryError),
      });
    }
    await finalizeConsoleRunRecord({ runId, status: "completed" });
    divider("completed");
    logLine("console workflow finished successfully", {
      runId,
      briefId: published.briefId,
      discovered: discovered.length,
      metadataReadyRecent: metadataReadyRecent.length,
      clusters: clusters.length,
      selectedClusters: primaryClusters.length,
      selectedSources: primaryClusters.reduce(
        (acc, row) => acc + row.sourceKeys.length,
        0,
      ),
      secondaryClusters: secondaryClusters.length,
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
