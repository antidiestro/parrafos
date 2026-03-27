# `src/scripts`

## Purpose
- Operational Node entrypoints run outside request/response lifecycle.

## Key Files
- `run-workflow-console.ts`: lightweight console entrypoint for standalone brief workflow execution.
- `workflow-console/*`: split console workflow modules (types, schemas/constants, logging, utils, stage implementations, orchestrator).
- `evaluate-clustering.ts`: offline baseline-vs-precision clustering evaluator for multilingual candidate sets.

## Workflow Console Behavior
- `npm run workflow:console`: executes the direct workflow pipeline from publisher crawl through brief publication.
- The pipeline is orchestrated in `workflow-console/index.ts` and split into explicit stage modules under `workflow-console/stages/`.
- Stage progress and diagnostics are emitted to stdout using the local logging helpers.
- The run-record stage persists a `runs` row lifecycle used for observability (`running` -> `completed`/`failed`).

## Logging
- Console workflow logs are emitted to stdout with stage dividers and structured metadata payloads.
- Logs include stage transitions and per-item outcomes (discovered/skipped, fetched+parsed, upserted/failed).

## Common Changes
- Console workflow behavior/logging: update `run-workflow-console.ts`.
- Extraction semantics: change `workflow-console/stages/*` and shared helpers in `src/lib/*`.
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
- Execute `npm run workflow:console` with a valid `.env`.
- Confirm process exits cleanly and run status transitions in DB.
- Confirm expected publish outputs are persisted (`briefs`, `stories`, `brief_paragraphs`, `story_articles`).

## Gotchas
- This script assumes `.env` is loaded by package script (`dotenv -e .env -- ...`).
- The workflow console performs live network and model calls; use with production-safe keys/config.
