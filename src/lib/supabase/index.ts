import { createSupabaseAnonClient } from './client'
import {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from './env'
import { createSupabaseServiceClient } from './service'

export { createSupabaseAnonClient } from './client'
export { createSupabaseServiceClient } from './service'
export {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from './env'

/** Node / scripts: anon client using `SUPABASE_URL` + `SUPABASE_ANON_KEY`. */
export function createSupabaseAnonClientFromEnv() {
  return createSupabaseAnonClient(getSupabaseUrl(), getSupabaseAnonKey())
}

/** Trusted server only: service client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. */
export function createSupabaseServiceClientFromEnv() {
  return createSupabaseServiceClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
  )
}
