import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../database.types";

/**
 * Browser or user-facing server routes: uses the **anon** key; RLS applies.
 * Supply URL and key from your env (e.g. `NEXT_PUBLIC_*` / `VITE_*` for browser bundles).
 */
export function createSupabaseAnonClient(url: string, anonKey: string) {
  return createClient<Database>(url, anonKey);
}
