import type { Json } from "@/database.types";
import {
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logLine } from "@/lib/runs/console/logging";

function consoleRunMetadata(): Json {
  return {
    model: RUN_MODEL,
    models: {
      identification: RUN_EXTRACT_MODEL,
      clustering: RUN_CLUSTER_MODEL,
      relevance_selection: RUN_RELEVANCE_MODEL,
      extraction: RUN_EXTRACT_MODEL,
    },
    publisher_count: 0,
    publishers_done: 0,
    articles_found: 0,
    articles_upserted: 0,
    clusters_total: 0,
    clusters_eligible: 0,
    clusters_selected: 0,
    sources_selected: 0,
    errors: [] as Json[],
    publishers: [] as Json[],
    articles: [] as Json[],
    publish: { brief_paragraphs: [] as Json[] },
  };
}

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
      metadata: consoleRunMetadata(),
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
