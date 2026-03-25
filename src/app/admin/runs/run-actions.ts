"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { createInitialRunMetadata } from "@/lib/runs/progress";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

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
