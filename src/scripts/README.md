# `src/scripts`

## Purpose
- Operational Node entrypoints run outside request/response lifecycle.

## Key Files
- `run-workflow-console.ts`: thin entrypoint for `npm run generate-brief`; delegates to `src/lib/runs/console`.
- `regenerate-brief-from-latest.ts`: entrypoint for `npm run regenerate-brief`; recomposes brief sections from the latest published brief’s story JSON and publishes a new brief (see `src/lib/runs/console/republish-brief-from-latest.ts`). Does **not** write a `runs` row.
- `test-discover-cluster-select.ts`: thin entrypoint for `npm run pipeline:dry-run:discover-select`; runs `runDiscoverClusterSelectDryRun` (`src/lib/runs/console/discover-cluster-select-dry-run.ts`).
- `evaluate-clustering.ts`: offline baseline-vs-precision clustering evaluator for multilingual candidate sets.

## Workflow Console Behavior
- `npm run generate-brief`: executes the direct workflow pipeline from publisher crawl through brief publication.
- `npm run regenerate-brief`: loads the latest published brief (ordered sections + `stories.detail_markdown`), runs `composeBriefSections` only, inserts a new `briefs` row with copied summary JSON and `story_articles` links from that prior brief. Requires `SUPABASE_*`, `GEMINI_API_KEY`, and optional `BRIEF_SECTION_*` compose env vars (same as full pipeline).
- Optional `RUN_MIN_PCT_NEW_CANDIDATES` (0–100): after discovery, if the percentage of canonical URLs **not** in the latest snapshot from a **prior successful** brief is below that value, the workflow sets `published_at` on the latest published brief to now, marks the run `completed`, and exits successfully (no prefetch/cluster/brief work, no snapshot update). If no published brief exists, the run fails. Snapshots are saved only when a run completes after a full successful publish. (Ignored by `regenerate-brief` and by `pipeline:dry-run:discover-select`.)
- `npm run pipeline:dry-run:discover-select`: runs discovery → **prefetch_metadata** (same headlines/recency path as production) → `cluster_sources` → `select_clusters`. Emits stage logs and per-selected-cluster lines to stdout. Performs **no DB writes** (no `runs` row, brief publish, article upserts, or `run_discovery_candidates`). Still **reads** `publishers` and `articles` (metadata cache during prefetch, same as the full workflow). **`RUN_MIN_PCT_NEW_CANDIDATES` does not apply**—the dry run always continues through selection when stages succeed. Requires `SUPABASE_*`, `GEMINI_API_KEY`, and optional `RUN_EXTRACT_CONCURRENCY` (prefetch concurrency, default 5, max 20).
- Implementation lives in `src/lib/runs/console/` (orchestration, logging, types) and `src/lib/runs/stages/` (stage modules). This script only boots the process and loads `.env` via the package script.
- Stage progress and diagnostics are emitted to stdout using the logging helpers in `lib/runs/console`.
- Run records are created and finalized in `lib/runs/stages/run-records.ts` (`running` → `completed`/`failed`).

## Logging
- Console workflow logs are emitted to stdout as **single-line** entries: short timestamps, `[stage] …` markers, and compact `key=value` context (truncated strings/URLs; errors as short messages, not nested JSON).
- Granularity is unchanged: stage transitions and per-item outcomes (discovered/skipped, fetched+parsed, upserted/failed) still appear when those events occur.

## Common Changes
- Console workflow behavior: update `src/lib/runs/console/` and `src/lib/runs/stages/`.
- Script-only tweaks (e.g. exit handling): update `run-workflow-console.ts`.
- Clustering quality evaluation workflow: update `evaluate-clustering.ts`.

## Clustering Evaluation Harness
- Command: `npm run eval:clustering -- --input <dataset.json> [--out <report.json>]`.
- Dataset shape:
  - root object with `samples`.
  - each sample includes `sample_id` and `candidates[]`.
  - each candidate includes at least `source_key`, `publisher_id`, and `url` (title/date hints optional).
- The harness compares:
  - baseline exhaustive clustering prompt,
  - precision-first sparse clustering prompt.
- Cluster quality uses model-based semantic judging (specific-story vs broad/mixed), so no lexical keyword matching assumptions are required across languages.
- Output includes per-sample metrics and aggregate averages for:
  - broad-cluster rate,
  - specific-cluster rate,
  - assigned coverage.

## Verification
- Execute `npm run generate-brief` or `npm run regenerate-brief` with a valid `.env`.
- For `generate-brief`, confirm process exits cleanly and run status transitions in DB.
- Confirm expected publish outputs are persisted (`briefs`, `stories`, `brief_sections`, `story_articles`).

## Gotchas
- This script assumes `.env` is loaded by package script (`dotenv -e .env -- ...`).
- The workflow console performs live network and model calls; use with production-safe keys/config.
