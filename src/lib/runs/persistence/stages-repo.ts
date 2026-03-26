import type { Json } from "@/database.types";
import type { RunStage, RunStageStatus } from "@/lib/runs/workflow";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function startRunStage(
  runId: string,
  stage: RunStage,
): Promise<number> {
  const supabase = createSupabaseServiceClient();
  const { data: latest, error: latestError } = await supabase
    .from("run_stage_executions")
    .select("attempt")
    .eq("run_id", runId)
    .eq("stage", stage)
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw new Error(latestError.message);
  const attempt = (latest?.attempt ?? 0) + 1;

  const now = new Date().toISOString();
  const { error: stageError } = await supabase.from("run_stage_executions").insert({
    run_id: runId,
    stage,
    attempt,
    status: "running",
    started_at: now,
    heartbeat_at: now,
  });
  if (stageError) throw new Error(stageError.message);

  const { error: runError } = await supabase
    .from("runs")
    .update({
      current_stage: stage,
      stage_attempt: attempt,
      last_heartbeat_at: now,
    })
    .eq("id", runId);
  if (runError) throw new Error(runError.message);

  return attempt;
}

export async function completeRunStage(
  runId: string,
  stage: RunStage,
  attempt: number,
  resumeCursor?: Json,
) {
  await setRunStageStatus(runId, stage, attempt, "completed", null, resumeCursor);
}

export async function failRunStage(
  runId: string,
  stage: RunStage,
  attempt: number,
  errorMessage: string,
  resumeCursor?: Json,
) {
  await setRunStageStatus(
    runId,
    stage,
    attempt,
    "failed",
    errorMessage,
    resumeCursor,
  );
}

export async function cancelRunStage(
  runId: string,
  stage: RunStage,
  attempt: number,
  resumeCursor?: Json,
) {
  await setRunStageStatus(runId, stage, attempt, "cancelled", null, resumeCursor);
}

async function setRunStageStatus(
  runId: string,
  stage: RunStage,
  attempt: number,
  status: RunStageStatus,
  errorMessage: string | null,
  resumeCursor?: Json,
) {
  const supabase = createSupabaseServiceClient();
  const now = new Date().toISOString();
  const { error: stageError } = await supabase
    .from("run_stage_executions")
    .update({
      status,
      ended_at: now,
      heartbeat_at: now,
      error_message: errorMessage,
      resume_cursor: resumeCursor ?? null,
    })
    .eq("run_id", runId)
    .eq("stage", stage)
    .eq("attempt", attempt);
  if (stageError) throw new Error(stageError.message);

  const { error: runError } = await supabase
    .from("runs")
    .update({
      last_heartbeat_at: now,
    })
    .eq("id", runId);
  if (runError) throw new Error(runError.message);
}
