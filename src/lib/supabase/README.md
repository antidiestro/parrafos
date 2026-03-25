# `src/lib/supabase`

## Purpose
- Typed Supabase client factories and env helpers for anon and service-role contexts.

## Key Files
- `client.ts`: anon client factory (RLS applies).
- `service.ts`: service-role client factory (bypasses RLS; server-only).
- `env.ts`: validated env accessors.
- `index.ts`: convenience exports + from-env constructors.
- `server.ts`: app-facing server-only helper for service client.

## Contracts and Invariants
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` must be present when required.
- Service-role client must never be imported into browser/client bundles.
- All clients are typed with `Database` (`src/database.types.ts`).

## Common Changes
- Add env behavior: update `env.ts` and downstream callers.
- Change client defaults/options: update factory modules and verify all consumers.
- Regenerate DB types after schema changes: `npm run update-types`.

## Verification
- `npm run lint`
- `npx tsc --noEmit`
- For DB changes: `npm run update-types` and ensure type-check passes.

## Gotchas
- Service role bypasses RLS; use it only in trusted server runtime.
- Keep module boundaries clear to prevent accidental client exposure.
