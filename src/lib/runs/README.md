# `src/lib/runs`

## Purpose
- **Console brief pipeline:** `console/` holds orchestration (`runConsoleWorkflow`), stdout logging, shared types/utils, and `pipeline-constants.ts` (Zod schemas and pipeline thresholds).
- **Stages:** `stages/` implements each step (discovery, prefetch, cluster, select, extract, upsert, summaries, compose, persist, run records).
- **Model config:** `constants.ts` — model IDs and recency windows used by orchestrator and stages.

## Key Files
- `constants.ts`: Gemini model IDs and recency window hours.
- `console/orchestrator.ts`: wires stages and run row lifecycle.
- `console/run-artifacts.ts`: writes per-run filesystem snapshots under `.tmp/latest-run`.
- `console/pipeline-constants.ts`: cluster/relevance/brief schemas and batch limits.
- `stages/run-records.ts`: creates and finalizes `runs` rows; metadata shape is inlined there.

## Local run artifacts (`.tmp/latest-run`)
- Each console workflow start **deletes and recreates** `.tmp/latest-run` at the repo root (path uses `process.cwd()`, so run `npm run generate-brief` from the repo root).
- Under that folder, each stage writes a subdirectory with data files (JSON/Markdown for model outputs and snapshots) plus `status.json` and human-readable `STATUS.md` when the stage completes successfully.
- Layout (stage slug → notable files):
  - `discover_candidates/`: `candidates.json`
  - `create_run_record/`: `run-record.json` (from orchestrator after the DB insert)
  - `prefetch_metadata/`: `metadata_ready_recent.json`, `prefetch_stats.json`
  - `cluster_sources/`: `model-response.json`, `clusters.json`
  - `select_clusters/`: `model-response.json`, `selected_clusters.json`
  - `extract_bodies/`: `llm/*.json` per successful extraction
  - `upsert_extracted_articles/`: `upsert-summary.json`
  - `generate_story_summaries/clusters/`: `*.json` and `*.md` per cluster
  - `compose_brief_paragraphs/`: `model-response.json`, `brief.md`
  - `persist_brief_output/`: `publish-result.json`
- `.tmp/` is gitignored; use this tree for local debugging and inspection only.

## Run lifecycle
- The console workflow inserts a `runs` row with `status = running`, then updates to `completed` or `failed` when the pipeline finishes.

## Extraction invariants (domain)
- Candidate URLs are canonicalized and deduplicated before extraction.
- Metadata prefetch reuses existing article metadata by canonical URL when available.
- Clustering is precision-first and may leave uncertain sources unclustered.
- Article upserts use conflict key `(publisher_id, canonical_url)`.

## Common Changes
- Model/threshold adjustments: update `constants.ts` and/or `console/pipeline-constants.ts`.
- Pipeline behavior: update `stages/*` or `console/orchestrator.ts`.

## Verification
- Run `npm run generate-brief`.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- This module assumes server-side service-role DB access where the workflow touches Supabase.
