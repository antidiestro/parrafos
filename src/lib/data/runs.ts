import type { Database } from "@/database.types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type RunRow = Database["public"]["Tables"]["runs"]["Row"];

export async function listRecentRuns(limit = 20): Promise<RunRow[]> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}
