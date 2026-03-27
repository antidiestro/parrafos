import {
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { divider, logLine } from "@/scripts/workflow-console/logging";
import type { ExtractedArticle } from "@/scripts/workflow-console/types";

export async function upsertExtractedArticles(
  extracted: ExtractedArticle[],
  runId: string,
): Promise<void> {
  divider("upsert_articles");
  if (extracted.length === 0) {
    logLine("upsert_articles: no new rows to upsert");
    return;
  }
  const supabase = createSupabaseServiceClient();
  logLine("upsert_articles: preparing rows", {
    runId,
    extractedCount: extracted.length,
  });
  const rows = extracted.map((article) => ({
    run_id: runId,
    publisher_id: article.publisherId,
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
  }));
  logLine("upsert_articles: db upsert started", { rowCount: rows.length });
  const { error } = await supabase
    .from("articles")
    .upsert(rows, { onConflict: "publisher_id,canonical_url" });
  if (error) throw new Error(error.message);
  logLine("upsert_articles: completed", { upsertedRows: rows.length });
}
