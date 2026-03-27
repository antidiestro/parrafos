import { extractArticleMetadata } from "@/lib/extract/article-candidates";
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
  mapWithConcurrency,
  type PrefetchedArticle,
  toCanonicalUrl,
  updateRunProgress,
} from "@/lib/runs/process/shared";

export async function runPrefetchMetadataStage(
  context: ProcessRunContext,
): Promise<void> {
  const { runId, metadata, extractConcurrency } = context;
  const prefetchStageAttempt = await startRunStage(runId, "prefetch_metadata");
  await appendRunEvent({
    runId,
    stage: "prefetch_metadata",
    eventType: "stage_started",
    message: "Metadata prefetch stage started",
  });

  const metadataReadyCandidates = await mapWithConcurrency(
    metadata.articles,
    extractConcurrency,
    async (article): Promise<PrefetchedArticle | null> => {
      if (await isRunCancelled(runId)) return null;
      article.status = "metadata_fetching";
      article.error_message = null;
      await updateRunProgress(runId, { metadata });

      try {
        const articleRes = await fetchHtmlWithRetries(article.url, {
          retries: 0,
        });
        const metadataResult = extractArticleMetadata(
          articleRes.finalUrl,
          articleRes.html,
        );
        if (!metadataResult) {
          article.status = "not_selected_for_extraction";
          article.error_message =
            "Discarded: missing Article/NewsArticle JSON-LD and no article:published_time meta.";
          await updateRunProgress(runId, { metadata });
          return null;
        }
        const canonicalUrl =
          toCanonicalUrl(
            metadataResult.canonicalUrl ?? articleRes.finalUrl,
            articleRes.finalUrl,
          ) ?? article.url;
        article.canonical_url = canonicalUrl;
        article.title = metadataResult.title ?? null;
        article.published_at = metadataResult.publishedAt ?? null;
        article.status = "metadata_ready";
        article.error_message = null;
        await updateRunProgress(runId, { metadata });

        const publisher = metadata.publishers.find(
          (entry) => entry.publisher_id === article.publisher_id,
        );
        return {
          publisherId: article.publisher_id,
          publisherName: publisher?.publisher_name ?? article.publisher_id,
          url: article.url,
          canonicalUrl,
          title: article.title,
          description: metadataResult.description,
          publishedAt: article.published_at,
          sourceUrl: articleRes.finalUrl,
          html: articleRes.html,
        };
      } catch (error) {
        article.status = "failed";
        article.error_message =
          errorToMessage(error) ?? "Metadata fetch failed";
        metadata.errors.push({
          publisher_id: article.publisher_id,
          url: article.url,
          message: errorToMessage(error) ?? "Metadata fetch failed",
        });
        await updateRunProgress(runId, { metadata });
        return null;
      }
    },
  );

  context.prefetchedByCandidateKey.clear();
  for (const candidate of metadataReadyCandidates) {
    if (!candidate) continue;
    context.prefetchedByCandidateKey.set(
      `${candidate.publisherId}::${candidate.url}`,
      candidate,
    );
  }
  context.identifiedCandidates = metadataReadyCandidates
    .filter((candidate): candidate is PrefetchedArticle => Boolean(candidate))
    .map((candidate) => ({
      publisherId: candidate.publisherId,
      publisherName: candidate.publisherName,
      url: candidate.url,
      canonicalUrl: candidate.canonicalUrl,
      title: candidate.title,
      description: candidate.description,
      publishedAt: candidate.publishedAt,
    }));

  await completeRunStage(runId, "prefetch_metadata", prefetchStageAttempt);
  await appendRunEvent({
    runId,
    stage: "prefetch_metadata",
    eventType: "stage_completed",
    message: "Metadata prefetch stage completed",
  });
}
