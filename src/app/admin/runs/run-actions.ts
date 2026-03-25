"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/require-admin";
import { RUN_MODEL } from "@/lib/runs/constants";
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
    metadata: {
      model: RUN_MODEL,
      publisher_count: 0,
      publishers_done: 0,
      articles_found: 0,
      articles_upserted: 0,
      errors: [],
    },
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/admin/runs");
  return { success: "Run queued." };
}
