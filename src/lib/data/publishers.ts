import type { Database } from "@/database.types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type PublisherRow = Database["public"]["Tables"]["publishers"]["Row"];

export async function listPublishers(): Promise<PublisherRow[]> {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("publishers")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}
