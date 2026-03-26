"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/require-admin";
import {
  retryBriefGenerationForFailedRun,
  retryFailedExtractionsForFailedRun,
} from "@/lib/runs/process";
import {
  RUN_CLUSTER_MODEL,
  RUN_EXTRACT_MODEL,
  RUN_RELEVANCE_MODEL,
} from "@/lib/runs/constants";
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
    extract_model: RUN_EXTRACT_MODEL,
    cluster_model: RUN_CLUSTER_MODEL,
    relevance_model: RUN_RELEVANCE_MODEL,
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

export async function retryFailedExtractionsAction(
  runId: string,
): Promise<RunActionState> {
  await requireAdminSession();
  try {
    const result = await retryFailedExtractionsForFailedRun(runId);
    revalidatePath("/admin/runs");
    revalidatePath(`/admin/runs/${runId}`);
    revalidatePath("/");
    if (result.briefPublished) {
      return {
        success: `Retried ${result.retriedCount} source extraction(s) missing usable body text, recovered ${result.succeededCount}, and published brief.`,
      };
    }
    return {
      success: `Retried ${result.retriedCount} source extraction(s) missing usable body text. Recovered ${result.succeededCount}; ${result.failedCount} still failed. Brief is still unavailable for this run.`,
    };
  } catch (error) {
    return { error: errorToMessage(error) };
  }
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
