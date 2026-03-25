# `supabase`

## Purpose
- Database source of truth: schema, policies, and migration history.

## What Lives Here
- `migrations/*.sql`: ordered DDL/policy changes.
- `seed.sql`: optional local seed data for local resets.
- `config.toml`: Supabase CLI configuration.

## Migration Workflow
- Create migration: `npx supabase migration new <name>`.
- Edit SQL in `migrations/`.
- Apply to linked project: `npm run db:push`.
- Regenerate TS types after schema changes: `npm run update-types`.

## RLS and Access Model
- Anonymous users read published editorial content.
- Authenticated users manage editorial tables and read ingestion artifacts.
- Service role performs ingestion writes and bypasses RLS.

## Common Changes
- Add/modify tables, enums, indexes, triggers in a new migration file.
- Update policies with explicit intent comments in the migration itself.
- Coordinate app/runtime changes with schema changes in the same PR.
- Ingestion clustering persistence is stored in:
  - `run_story_clusters` (story-level cluster rows per run),
  - `run_story_cluster_sources` (source assignments per cluster with one-source-per-run uniqueness).

## Verification
- Apply migration to target environment.
- Validate policy behavior for anon/authenticated/service role contexts.
- Run `npm run update-types` and `npx tsc --noEmit`.

## Gotchas
- `db push` affects linked remote project; test risky changes in staging first.
- Never rewrite already-applied migration files in shared environments.
