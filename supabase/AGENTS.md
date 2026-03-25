# AGENTS Guide (`supabase/`)

## Scope
- Applies to `supabase/**` (migrations, seed, and CLI config).

## Read These First
- `supabase/README.md`
- Root operational context: `README.md`

## Where to Implement Changes
- Schema/policies/indexes/triggers: add new files in `supabase/migrations/`.
- Optional local seed data: `supabase/seed.sql`.
- CLI defaults: `supabase/config.toml` when needed.

## Guardrails
- Prefer additive forward migrations; do not rewrite migration history already applied in shared environments.
- Keep RLS policy intent explicit in SQL comments.
- Coordinate schema changes with app/runtime code and generated types.

## Mandatory Documentation Update Policy
- Any migration or policy change must include updates to `supabase/README.md` (and any impacted domain docs under `src/`) in the same change when behavior or operational workflow changes.

## Validation
- Apply migrations with `npm run db:push` (in the intended environment).
- Regenerate types: `npm run update-types`.
- Verify app type-check: `npx tsc --noEmit`.
