/**
 * Node-style env helpers. For Vite, use `import.meta.env` and pass strings into the factories.
 */
export function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL
  if (!url) {
    throw new Error('Missing SUPABASE_URL')
  }
  return url
}

export function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY
  if (!key) {
    throw new Error('Missing SUPABASE_ANON_KEY')
  }
  return key
}

export function getSupabaseServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')
  }
  return key
}
