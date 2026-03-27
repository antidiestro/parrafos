import {
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { createInitialRunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logLine } from "@/scripts/workflow-console/logging";

export async function createConsoleRunRecord(): Promise<string> {
  logLine("runs: creating console run record");
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("runs")
    .insert({
      status: "running",
      extract_model: RUN_EXTRACT_MODEL,
      cluster_model: RUN_CLUSTER_MODEL,
      relevance_model: RUN_RELEVANCE_MODEL,
      metadata: createInitialRunMetadata(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  logLine("runs: console run record created", { runId: data.id });
  return data.id;
}

export async function finalizeConsoleRunRecord(input: {
  runId: string;
  status: "completed" | "failed";
  errorMessage?: string;
}) {
  logLine(
    "runs: finalizing console run record",
    input.errorMessage
      ? {
          runId: input.runId,
          status: input.status,
          errorMessage: input.errorMessage,
        }
      : { runId: input.runId, status: input.status },
  );
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("runs")
    .update({
      status: input.status,
      ended_at: new Date().toISOString(),
      error_message: input.errorMessage ?? null,
    })
    .eq("id", input.runId);
  if (error) throw new Error(error.message);
  logLine("runs: console run record finalized", {
    runId: input.runId,
    status: input.status,
  });
}
