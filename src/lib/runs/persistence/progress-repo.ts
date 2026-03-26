import type { Json } from "@/database.types";
import type { RunMetadata } from "@/lib/runs/progress";
import type { RunSummaryPatch } from "@/lib/runs/workflow";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

function toSummaryPatch(metadata: RunMetadata): RunSummaryPatch {
  return {
    extract_model: metadata.models?.extraction ?? metadata.model,
    cluster_model: metadata.models?.clustering ?? metadata.model,
    relevance_model: metadata.models?.relevance_selection ?? metadata.model,
    publisher_count: metadata.publisher_count,
    publishers_done: metadata.publishers_done,
    articles_found: metadata.articles_found,
    articles_upserted: metadata.articles_upserted,
    clusters_total: metadata.clusters_total,
    clusters_eligible: metadata.clusters_eligible,
    clusters_selected: metadata.clusters_selected,
    sources_selected: metadata.sources_selected,
  };
}

export async function persistRunProgressSnapshot(
  runId: string,
  metadata: RunMetadata,
) {
  const supabase = createSupabaseServiceClient();
  const summary = toSummaryPatch(metadata);
  const now = new Date().toISOString();

  const { error: runError } = await supabase
    .from("runs")
    .update({
      ...summary,
      last_heartbeat_at: now,
      metadata: metadata as Json,
    })
    .eq("id", runId);
  if (runError) throw new Error(runError.message);

  const publisherRows = metadata.publishers.map((publisher) => ({
    run_id: runId,
    publisher_id: publisher.publisher_id,
    publisher_name: publisher.publisher_name,
    base_url: publisher.base_url,
    status: publisher.status,
    articles_found: publisher.articles_found,
    articles_upserted: publisher.articles_upserted,
    error_message: publisher.error_message,
  }));
  if (publisherRows.length > 0) {
    const { error } = await supabase.from("run_publishers_progress").upsert(
      publisherRows,
      { onConflict: "run_id,publisher_id" },
    );
    if (error) throw new Error(error.message);
  }

  const articleRows = metadata.articles.map((article) => ({
    run_id: runId,
    publisher_id: article.publisher_id,
    url: article.url,
    canonical_url: article.canonical_url,
    title: article.title,
    published_at: article.published_at,
    status: article.status,
    error_message: article.error_message,
  }));
  if (articleRows.length > 0) {
    const { error } = await supabase.from("run_articles_progress").upsert(
      articleRows,
      { onConflict: "run_id,publisher_id,url" },
    );
    if (error) throw new Error(error.message);
  }

  const { error: clearErrorsError } = await supabase
    .from("run_errors")
    .delete()
    .eq("run_id", runId);
  if (clearErrorsError) throw new Error(clearErrorsError.message);

  if (metadata.errors.length > 0) {
    const { error } = await supabase.from("run_errors").insert(
      metadata.errors.map((entry) => ({
        run_id: runId,
        publisher_id: entry.publisher_id ?? null,
        url: entry.url ?? null,
        message: entry.message,
      })),
    );
    if (error) throw new Error(error.message);
  }
}
