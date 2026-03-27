import { getRunDetailPayload } from "@/lib/data/runs";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import {
  canRetryBriefGeneration,
  getBriefRetryAvailability,
} from "@/lib/runs/brief-retry";
import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import {
  cleanTextForLLM,
  errorToMessage,
  extractArticleBodyText,
  findMetadataArticleProgress,
  type RetryFailedExtractionsResult,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
  updateRunProgress,
} from "@/lib/runs/process/shared";
import { runComposeBriefParagraphsStage } from "@/lib/runs/process/stage-compose-brief-paragraphs";
import { runGenerateStorySummariesStage } from "@/lib/runs/process/stage-generate-story-summaries";
import { runPersistBriefOutputStage } from "@/lib/runs/process/stage-persist-brief-output";
import type { RunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const PUBLISH_STAGES = [
  "generate_story_summaries",
  "compose_brief_paragraphs",
  "persist_brief_output",
] as const;

type PublishStage = (typeof PUBLISH_STAGES)[number];

function asPublishStage(stage: string | null | undefined): PublishStage | null {
  if (!stage) return null;
  return PUBLISH_STAGES.includes(stage as PublishStage)
    ? (stage as PublishStage)
    : null;
}

async function retryPublishStagesFromCurrentFailure(input: {
  runId: string;
  metadata: RunMetadata;
  currentStage: string | null;
}) {
  const { runId, metadata, currentStage } = input;
  const startStage = asPublishStage(currentStage) ?? "generate_story_summaries";

  if (startStage !== "generate_story_summaries") {
    const summaries = metadata.publish?.story_summaries ?? [];
    if (summaries.length === 0) {
      throw new Error(
        "Cannot retry publish from compose/persist stage because story summary checkpoint is missing.",
      );
    }
  }
  if (startStage === "persist_brief_output") {
    const paragraphs = metadata.publish?.brief_paragraphs ?? [];
    if (paragraphs.length === 0) {
      throw new Error(
        "Cannot retry publish from persist stage because brief paragraph checkpoint is missing.",
      );
    }
  }

  if (startStage === "generate_story_summaries") {
    await runGenerateStorySummariesStage({ runId, metadata });
  }
  if (
    startStage === "generate_story_summaries" ||
    startStage === "compose_brief_paragraphs"
  ) {
    await runComposeBriefParagraphsStage({ runId, metadata });
  }
  await runPersistBriefOutputStage({ runId, metadata });
}

function assertManualPublishRegenerationAllowed(status: string) {
  if (status === "pending" || status === "running") {
    throw new Error(
      "Cannot manually regenerate publish stages while the run is pending or running.",
    );
  }
}

export async function retryBriefGenerationForFailedRun(
  runId: string,
): Promise<void> {
  const payload = await getRunDetailPayload(runId);
  if (!payload) throw new Error("Run not found");
  if (payload.run.status !== "failed") {
    throw new Error("Only failed runs can retry brief generation");
  }
  if (!canRetryBriefGeneration(payload)) {
    throw new Error(
      "Brief retry needs all publishers completed, selected story clusters, and extracted article text for each selected story.",
    );
  }

  await retryPublishStagesFromCurrentFailure({
    runId,
    metadata: payload.metadata,
    currentStage: payload.run.current_stage,
  });
  await updateRunProgress(runId, {
    status: "completed",
    ended_at: new Date().toISOString(),
    error_message: null,
    metadata: payload.metadata,
  });
}

export async function regenerateStorySummariesForRun(
  runId: string,
): Promise<void> {
  const payload = await getRunDetailPayload(runId);
  if (!payload) throw new Error("Run not found");
  assertManualPublishRegenerationAllowed(payload.run.status);

  await runGenerateStorySummariesStage({
    runId,
    metadata: payload.metadata,
  });
  await updateRunProgress(runId, {
    error_message: null,
    metadata: payload.metadata,
  });
}

export async function regenerateBriefParagraphsForRun(
  runId: string,
): Promise<void> {
  const payload = await getRunDetailPayload(runId);
  if (!payload) throw new Error("Run not found");
  assertManualPublishRegenerationAllowed(payload.run.status);

  const storySummaries = payload.metadata.publish?.story_summaries ?? [];
  if (storySummaries.length === 0) {
    throw new Error(
      "Cannot regenerate brief paragraphs before story summaries are generated.",
    );
  }

  await runComposeBriefParagraphsStage({
    runId,
    metadata: payload.metadata,
  });
  await runPersistBriefOutputStage({
    runId,
    metadata: payload.metadata,
  });
  await updateRunProgress(runId, {
    status: "completed",
    ended_at: new Date().toISOString(),
    error_message: null,
    metadata: payload.metadata,
  });
}

export async function retryFailedExtractionsForFailedRun(
  runId: string,
): Promise<RetryFailedExtractionsResult> {
  const payload = await getRunDetailPayload(runId);
  if (!payload) throw new Error("Run not found");
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

  const sourceByKey = new Map<string, (typeof selectedSources)[number]>();
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
      if (upsertError) throw new Error(upsertError.message);

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
  if (!refreshed) throw new Error("Run not found after extraction retries");

  let briefPublished = false;
  if (canRetryBriefGeneration(refreshed)) {
    await retryPublishStagesFromCurrentFailure({
      runId,
      metadata: refreshed.metadata,
      currentStage: refreshed.run.current_stage,
    });
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
