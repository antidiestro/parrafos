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
- Authenticated users manage editorial tables and read ingestion artifacts where policies allow.
- Service role performs ingestion writes and bypasses RLS.

## Current ingestion / editorial shape
- **`runs`**: workflow console creates a row per execution (`status`: `running` → `completed` | `failed`), with `extract_model`, `cluster_model`, `relevance_model`, and optional `metadata` JSON. Legacy normalized progress tables and `run_stage` enums were removed in `20260327200000_prune_legacy_run_workflow.sql`.
- **`run_discovery_candidates`**: one row per **successfully completed** console run (`run_id` PK), `canonical_urls` text array (deduplicated, sorted) for the **full** initial discovery set (same as `discover_candidates`), written at the end of the pipeline—not the subset used in the published brief. RLS: authenticated **select** only; inserts via service role.
- **`articles`**: one row per `(publisher_id, canonical_url)`; stores `source_url`, `extraction_model`, `clustering_model`, `relevance_selection_model`, body text, and `run_id` for the extracting run.
- **Editorial**: `briefs`, `stories` (`markdown` and `detail_markdown` hold the same **stringified structured story summary JSON** from the pipeline), ordered **`brief_sections`** (final markdown per story in the brief), and **`story_articles`** linking stories to source articles.

## Verification
- Apply migration to target environment.
- Validate policy behavior for anon/authenticated/service role contexts.
- Run `npm run update-types` and `npx tsc --noEmit`.

## Gotchas
- `db push` affects linked remote project; test risky changes in staging first.
- Never rewrite already-applied migration files in shared environments.
