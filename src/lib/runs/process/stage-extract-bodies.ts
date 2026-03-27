import { fetchHtmlWithRetries } from "@/lib/extract/fetch";
import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import type { ProcessRunContext } from "@/lib/runs/process/context";
import {
  cleanTextForLLM,
  errorToMessage,
  extractArticleBodyText,
  isRunCancelled,
  logRun,
  updateRunProgress,
} from "@/lib/runs/process/shared";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

async function articleExists(
  publisherId: string,
  canonicalUrl: string,
): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("articles")
    .select("id")
    .eq("publisher_id", publisherId)
    .eq("canonical_url", canonicalUrl)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function runExtractBodiesStage(
  context: ProcessRunContext,
): Promise<void> {
  const { runId, metadata } = context;
  const extractStageAttempt = await startRunStage(runId, "extract_bodies");
  await appendRunEvent({
    runId,
    stage: "extract_bodies",
    eventType: "stage_started",
    message: "Extract bodies stage started",
  });

  const candidatesToExtract = [];
  for (const candidate of context.selectedCandidates) {
    if (await isRunCancelled(runId)) return;
    const progress = metadata.articles.find(
      (entry) =>
        entry.publisher_id === candidate.publisherId &&
        entry.url === candidate.url,
    );
    try {
      const exists = await articleExists(
        candidate.publisherId,
        candidate.canonicalUrl,
      );
      if (exists) {
        if (progress) {
          progress.status = "skipped_existing";
          progress.error_message = null;
        }
      } else {
        candidatesToExtract.push(candidate);
      }
    } catch (error) {
      if (progress) {
        progress.status = "failed";
        progress.error_message =
          errorToMessage(error) ?? "Existing article check failed";
      }
      metadata.errors.push({
        publisher_id: candidate.publisherId,
        url: candidate.url,
        message: errorToMessage(error) ?? "Existing article check failed",
      });
    }
    await updateRunProgress(runId, { metadata });
  }

  const extractedArticles = [];
  for (const candidate of candidatesToExtract) {
    if (await isRunCancelled(runId)) break;
    const articleProgress = metadata.articles.find(
      (entry) =>
        entry.publisher_id === candidate.publisherId &&
        entry.url === candidate.url,
    );
    if (articleProgress) {
      articleProgress.status = "fetching";
      articleProgress.error_message = null;
      await updateRunProgress(runId, { metadata });
    }

    try {
      const prefetched = context.prefetchedByCandidateKey.get(
        `${candidate.publisherId}::${candidate.url}`,
      );
      const articleRes = prefetched
        ? { finalUrl: prefetched.sourceUrl, html: prefetched.html }
        : await fetchHtmlWithRetries(candidate.url, { retries: 0 });
      const cleanedArticleText = cleanTextForLLM(articleRes.html);
      const details = await extractArticleBodyText(
        articleRes.finalUrl,
        cleanedArticleText,
        candidate.title,
      );
      if (articleProgress) {
        articleProgress.canonical_url = candidate.canonicalUrl;
        articleProgress.title = candidate.title;
        articleProgress.published_at = candidate.publishedAt;
        articleProgress.status = "extracted";
        await updateRunProgress(runId, { metadata });
      }
      extractedArticles.push({
        ...candidate,
        sourceUrl: articleRes.finalUrl,
        canonicalUrl: candidate.canonicalUrl,
        title: candidate.title,
        bodyText: details.body_text,
        publishedAt: candidate.publishedAt,
      });
    } catch (error) {
      if (articleProgress) {
        articleProgress.status = "failed";
        articleProgress.error_message =
          errorToMessage(error) ?? "Article extraction failed";
      }
      logRun(runId, "article extraction: failed", {
        publisherId: candidate.publisherId,
        url: candidate.url,
        canonicalUrl: candidate.canonicalUrl,
        error: errorToMessage(error),
      });
      metadata.errors.push({
        publisher_id: candidate.publisherId,
        url: candidate.url,
        message: errorToMessage(error) ?? "Article extraction failed",
      });
      await updateRunProgress(runId, { metadata });
      extractedArticles.push(null);
    }
  }

  context.extractedArticles = extractedArticles;
  await completeRunStage(runId, "extract_bodies", extractStageAttempt);
  await appendRunEvent({
    runId,
    stage: "extract_bodies",
    eventType: "stage_completed",
    message: "Extract bodies stage completed",
  });
}
