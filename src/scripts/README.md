# `src/scripts`

## Purpose
- Operational Node entrypoints run outside request/response lifecycle.

## Key Files
- `run-workflow-console.ts`: thin entrypoint for `npm run generate-brief`; delegates to `src/lib/runs/console`.
- `evaluate-clustering.ts`: offline baseline-vs-precision clustering evaluator for multilingual candidate sets.

## Workflow Console Behavior
- `npm run generate-brief`: executes the direct workflow pipeline from publisher crawl through brief publication.
- Implementation lives in `src/lib/runs/console/` (orchestration, logging, types) and `src/lib/runs/stages/` (stage modules). This script only boots the process and loads `.env` via the package script.
- Stage progress and diagnostics are emitted to stdout using the logging helpers in `lib/runs/console`.
- Run records are created and finalized in `lib/runs/stages/run-records.ts` (`running` → `completed`/`failed`).

## Logging
- Console workflow logs are emitted to stdout with stage dividers and structured metadata payloads.
- Logs include stage transitions and per-item outcomes (discovered/skipped, fetched+parsed, upserted/failed).

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
- Execute `npm run generate-brief` with a valid `.env`.
- Confirm process exits cleanly and run status transitions in DB.
- Confirm expected publish outputs are persisted (`briefs`, `stories`, `brief_sections`, `story_articles`).

## Gotchas
- This script assumes `.env` is loaded by package script (`dotenv -e .env -- ...`).
- The workflow console performs live network and model calls; use with production-safe keys/config.
