"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { retryBriefGenerationForFailedRun } from "@/lib/runs/process";
import { createInitialRunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type RunActionState = { error?: string; success?: string } | null;

export async function startRunAction(
  _prev: RunActionState,
  _formData: FormData,
): Promise<RunActionState> {
  void _prev;
  void _formData;
  await requireAdminSession();
  const supabase = createSupabaseServiceClient();

  const { error } = await supabase.from("runs").insert({
    status: "pending",
    metadata: createInitialRunMetadata(),
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/runs");
  return { success: "Run queued." };
}

export async function retryBriefGenerationAction(
  runId: string,
): Promise<RunActionState> {
  await requireAdminSession();
  try {
    await retryBriefGenerationForFailedRun(runId);
  } catch (error) {
    return { error: errorToMessage(error) };
  }

  revalidatePath("/admin/runs");
  revalidatePath(`/admin/runs/${runId}`);
  revalidatePath("/");
  return { success: "Brief published; run marked completed." };
}

export async function cancelRunAction(runId: string): Promise<RunActionState> {
  await requireAdminSession();
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("runs")
    .update({
      status: "cancelled",
      ended_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", runId)
    .in("status", ["pending", "running"]);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/runs");
  revalidatePath(`/admin/runs/${runId}`);
  return { success: "Run cancelled." };
}
