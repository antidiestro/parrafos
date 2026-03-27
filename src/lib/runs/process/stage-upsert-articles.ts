import { appendRunEvent } from "@/lib/runs/persistence/events-repo";
import {
  completeRunStage,
  startRunStage,
} from "@/lib/runs/persistence/stages-repo";
import type { ProcessRunContext } from "@/lib/runs/process/context";
import {
  errorToMessage,
  isRunCancelled,
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
  updateRunProgress,
} from "@/lib/runs/process/shared";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function runUpsertArticlesStage(
  context: ProcessRunContext,
): Promise<void> {
  const { runId, metadata } = context;
  const supabase = createSupabaseServiceClient();
  const upsertStageAttempt = await startRunStage(runId, "upsert_articles");
  await appendRunEvent({
    runId,
    stage: "upsert_articles",
    eventType: "stage_started",
    message: "Upsert articles stage started",
  });

  for (const article of context.extractedArticles) {
    if (await isRunCancelled(runId)) return;
    if (!article) continue;
    try {
      const { error: upsertError } = await supabase.from("articles").upsert(
        {
          publisher_id: article.publisherId,
          run_id: runId,
          canonical_url: article.canonicalUrl,
          title: article.title,
          body_text: article.bodyText,
          published_at: article.publishedAt,
          source_url: article.sourceUrl,
          extraction_model: RUN_EXTRACT_MODEL,
          clustering_model: RUN_CLUSTER_MODEL,
          relevance_selection_model: RUN_RELEVANCE_MODEL,
          metadata: {
            source_url: article.sourceUrl,
            model: RUN_EXTRACT_MODEL,
            clustering_model: RUN_CLUSTER_MODEL,
            relevance_selection_model: RUN_RELEVANCE_MODEL,
          },
        },
        { onConflict: "publisher_id,canonical_url" },
      );
      if (upsertError) throw new Error(upsertError.message);
      metadata.articles_upserted += 1;
      const publisherProgress = metadata.publishers.find(
        (entry) => entry.publisher_id === article.publisherId,
      );
      if (publisherProgress) {
        publisherProgress.articles_upserted += 1;
      }
      const articleProgress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === article.publisherId &&
          (entry.url === article.canonicalUrl ||
            entry.url === article.sourceUrl ||
            entry.canonical_url === article.canonicalUrl),
      );
      if (articleProgress) {
        articleProgress.status = "upserted";
      }
      await updateRunProgress(runId, { metadata });
    } catch (error) {
      const articleProgress = metadata.articles.find(
        (entry) =>
          entry.publisher_id === article.publisherId &&
          (entry.url === article.canonicalUrl ||
            entry.url === article.sourceUrl ||
            entry.canonical_url === article.canonicalUrl),
      );
      if (articleProgress) {
        articleProgress.status = "failed";
        articleProgress.error_message =
          errorToMessage(error) ?? "Article upsert failed";
      }
      metadata.errors.push({
        publisher_id: article.publisherId,
        url: article.sourceUrl,
        message: errorToMessage(error) ?? "Article upsert failed",
      });
      await updateRunProgress(runId, { metadata });
    }
  }

  await completeRunStage(runId, "upsert_articles", upsertStageAttempt);
  await appendRunEvent({
    runId,
    stage: "upsert_articles",
    eventType: "stage_completed",
    message: "Upsert articles stage completed",
  });
}
