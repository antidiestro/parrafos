import { listPublishers } from "@/lib/data/publishers";
import { extractArticleCandidatesFromHomepage } from "@/lib/extract/article-candidates";
import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import type { ProcessRunContext } from "@/lib/runs/process/context";
import {
  errorToMessage,
  isRunCancelled,
  logRun,
  toCanonicalUrl,
  updateRunProgress,
} from "@/lib/runs/process/shared";

export async function runDiscoverCandidatesStage(
  context: ProcessRunContext,
): Promise<void> {
  const { runId, metadata } = context;
  const publishers = await listPublishers();
  metadata.publisher_count = publishers.length;
  metadata.publishers = publishers.map((publisher) => ({
    publisher_id: publisher.id,
    publisher_name: publisher.name,
    base_url: publisher.base_url,
    status: "pending",
    articles_found: 0,
    articles_upserted: 0,
    error_message: null,
  }));
  await updateRunProgress(runId, { metadata });
  if (await isRunCancelled(runId)) return;

  const discoverStageAttempt = await startRunStage(runId, "discover_candidates");
  await appendRunEvent({
    runId,
    stage: "discover_candidates",
    eventType: "stage_started",
    message: "Discover candidates stage started",
  });

  for (const publisher of publishers) {
    if (await isRunCancelled(runId)) return;

    const publisherProgress = metadata.publishers.find(
      (entry) => entry.publisher_id === publisher.id,
    );
    try {
      if (publisherProgress) {
        publisherProgress.status = "running";
        publisherProgress.error_message = null;
        await updateRunProgress(runId, { metadata });
      }

      const home = await fetchHtmlWithRetries(publisher.base_url, { retries: 0 });
      const candidates = extractArticleCandidatesFromHomepage(
        publisher.base_url,
        home.html,
      );
      const normalizedUrls = Array.from(
        new Set(
          candidates
            .map((c) => toCanonicalUrl(c.url, publisher.base_url))
            .filter((value): value is string => Boolean(value)),
        ),
      ).slice(0, 15);

      metadata.articles_found += normalizedUrls.length;
      if (publisherProgress) {
        publisherProgress.articles_found = normalizedUrls.length;
      }

      metadata.articles.push(
        ...normalizedUrls.map((url) => ({
          publisher_id: publisher.id,
          url,
          canonical_url: null,
          title: null,
          published_at: null,
          status: "identified" as const,
          error_message: null,
        })),
      );
      await updateRunProgress(runId, { metadata });
    } catch (error) {
      if (publisherProgress) {
        publisherProgress.status = "failed";
        publisherProgress.error_message =
          errorToMessage(error) ?? "Publisher crawl failed";
      }
      logRun(runId, "publisher crawl: failed", {
        publisherId: publisher.id,
        publisherName: publisher.name,
        baseUrl: publisher.base_url,
        error: errorToMessage(error),
      });
      metadata.errors.push({
        publisher_id: publisher.id,
        message: errorToMessage(error) ?? "Publisher crawl failed",
      });
    } finally {
      metadata.publishers_done += 1;
      if (publisherProgress && publisherProgress.status === "running") {
        publisherProgress.status = "completed";
      }
      await updateRunProgress(runId, { metadata });
    }
  }

  await completeRunStage(runId, "discover_candidates", discoverStageAttempt);
  await appendRunEvent({
    runId,
    stage: "discover_candidates",
    eventType: "stage_completed",
    message: "Discover candidates stage completed",
  });
}
