import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type RunStorySummaryCheckpoint = {
  cluster_id: string;
  title: string;
  detail_markdown: string;
};

export async function replaceRunStorySummaries(
  runId: string,
  summaries: RunStorySummaryCheckpoint[],
) {
  const supabase = createSupabaseServiceClient();

  const { error: clearError } = await supabase
    .from("run_story_summaries")
    .delete()
    .eq("run_id", runId);
  if (clearError) throw new Error(clearError.message);

  if (summaries.length === 0) {
    return;
  }

  const rows = summaries.map((summary, idx) => ({
    run_id: runId,
    cluster_id: summary.cluster_id,
    title: summary.title,
    detail_markdown: summary.detail_markdown,
    position: idx + 1,
  }));

  const { error: insertError } = await supabase
    .from("run_story_summaries")
    .insert(rows);
  if (insertError) throw new Error(insertError.message);
}

export async function listRunStorySummaries(
  runId: string,
): Promise<RunStorySummaryCheckpoint[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("run_story_summaries")
    .select("cluster_id,title,detail_markdown")
    .eq("run_id", runId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    cluster_id: row.cluster_id,
    title: row.title,
    detail_markdown: row.detail_markdown,
  }));
}
