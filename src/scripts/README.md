# `src/scripts`

## Purpose
- Operational Node entrypoints run outside request/response lifecycle.

## Key Files
- `run-worker.ts`: claims queued runs and executes extraction pipeline continuously or once.
- `run-workflow-console.ts`: lightweight console entrypoint for standalone brief workflow execution.
- `workflow-console/*`: split console workflow modules (types, schemas/constants, logging, utils, stage implementations, orchestrator).
- `evaluate-clustering.ts`: offline baseline-vs-precision clustering evaluator for multilingual candidate sets.

## Worker Behavior
- `npm run worker:runs`: infinite polling loop (2s sleep when queue is empty).
- `npm run worker:runs:watch`: same worker loop, auto-restarts when relevant source files change.
- `npm run worker:runs -- --once`: claim and process at most one pending run, then exit.
- Delegates actual run logic to `src/lib/runs/process.ts`.
- During processing, run stage attempts are persisted in `run_stage_executions` and mirrored into `runs.current_stage`/`runs.stage_attempt`.
- `npm run workflow:console`: executes a separate direct workflow pipeline from publisher crawl through brief publication without creating/updating run-progress rows; stage progress is printed directly to stdout.

## Logging
- Worker-level logs are emitted via `console.log` with the prefix `[worker:runs]`.
- During `processRun`, logs include stage transitions (publisher crawl, clustering, extraction, upserts, brief publishing) plus per-article outcomes (queued/skipped, fetched+parsed, upserted/failed).

## Common Changes
- Polling cadence/runtime behavior: update `run-worker.ts`.
- Console workflow behavior/logging: update `run-workflow-console.ts`.
- Extraction semantics: change `src/lib/runs` instead of this script.
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
- Queue one run in admin, then execute `--once`.
- Confirm process exits cleanly and run status transitions in DB.
- Confirm normalized progress tables are updated while run is active (`run_publishers_progress`, `run_articles_progress`, `run_errors`, `run_events`).

## Gotchas
- This script assumes `.env` is loaded by package script (`dotenv -e .env -- ...`).
- If worker is not running, queued runs remain `pending`.
