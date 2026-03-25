import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../database.types'

/**
 * Extraction workers and trusted server code only: uses the **service_role** key (bypasses RLS).
 * Never import this module from client-side bundles.
 */
export function createSupabaseServiceClient(url: string, serviceRoleKey: string) {
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
