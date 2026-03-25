import { createSupabaseServiceClientFromEnv } from "./index";

/** Server-only Supabase client (service role). Use only in RSC, Route Handlers, and Server Actions. */
export function createSupabaseServiceClient() {
  return createSupabaseServiceClientFromEnv();
}
