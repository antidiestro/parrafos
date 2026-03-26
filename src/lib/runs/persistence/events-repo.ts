import type { Json } from "@/database.types";
import type { RunStage } from "@/lib/runs/workflow";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function appendRunEvent(input: {
  runId: string;
  stage?: RunStage;
  eventType: string;
  message?: string;
  context?: Json;
}) {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("run_events").insert({
    run_id: input.runId,
    stage: input.stage ?? null,
    event_type: input.eventType,
    message: input.message ?? null,
    context: input.context ?? null,
  });
  if (error) throw new Error(error.message);
}
