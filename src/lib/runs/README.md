# `src/lib/runs`

## Purpose
- **Console brief pipeline:** `console/` holds orchestration (`runConsoleWorkflow`), stdout logging, shared types/utils, and `pipeline-constants.ts` (Zod schemas and pipeline thresholds).
- **Stages:** `stages/` implements each step (discovery, prefetch, cluster, select, extract, upsert, summaries, compose brief sections, persist, run records).
- **Model config:** `constants.ts` — model IDs and recency windows used by orchestrator and stages.

## Key Files
- `constants.ts`: Gemini model IDs and recency window hours.
- `console/orchestrator.ts`: wires stages and run row lifecycle.
- `console/pipeline-constants.ts`: cluster/relevance/brief schemas and batch limits.
- `stages/run-records.ts`: creates and finalizes `runs` rows; metadata shape is inlined there.
- `stages/generate-story-summaries.ts`: LLM step that emits one **structured JSON** object per story (Zod: `simpleStorySummarySchema`); `quotes` include **`speaker_context`** (role/affiliation); **`key_facts`** are longer-form detailed items. The stringified JSON is stored in `stories.markdown` / `detail_markdown` and passed to compose.
- `stages/compose-brief-sections.ts`: LLM step that reads those JSON payloads and emits one markdown section per story (~500-character paragraph with a bold lead-in title); structured output uses a `sections` array.

## Run lifecycle
- The console workflow inserts a `runs` row with `status = running`, then updates to `completed` or `failed` when the pipeline finishes.

## Extraction invariants (domain)
- Candidate URLs are canonicalized and deduplicated before extraction.
- Metadata prefetch reuses existing article metadata by canonical URL when available.
- Clustering assigns every candidate source to exactly one run-scoped story cluster; singleton clusters are allowed, and multi-outlet groupings are kept when the model merges clearly related coverage.
- Relevance selection (`select-clusters`) only sends **multi-source** clusters (two or more articles) to the model; singleton clusters never enter that LLM call.
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
