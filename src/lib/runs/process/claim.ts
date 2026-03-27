import { createInitialRunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logRun } from "@/lib/runs/process/shared";

export async function claimNextPendingRun(): Promise<{ id: string } | null> {
  logRun(null, "claimNextPendingRun: searching pending run");
  const supabase = createSupabaseServiceClient();
  const { data: pending, error: pendingError } = await supabase
    .from("runs")
    .select("id")
    .eq("status", "pending")
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pendingError) {
    throw new Error(pendingError.message);
  }
  if (!pending) return null;

  const metadata = createInitialRunMetadata();
  const { data: claimed, error: claimError } = await supabase
    .from("runs")
    .update({
      status: "running",
      error_message: null,
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
      current_stage: null,
      stage_attempt: 0,
      last_heartbeat_at: new Date().toISOString(),
      metadata,
    })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  return claimed ?? null;
}
