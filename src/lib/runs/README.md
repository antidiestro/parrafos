# `src/lib/runs`

## Purpose
- Shared run configuration (`constants.ts`) for the workflow console pipeline. Run rows are created/finalized in `src/scripts/workflow-console/stages/run-records.ts`; metadata shape is inlined there.

## Key Files
- `constants.ts`: model IDs and thresholds used by workflow stages.

## Run lifecycle
- Workflow console inserts a `runs` row with `status = running`, then updates to `completed` or `failed` when the pipeline finishes.

## Extraction invariants (domain)
- Candidate URLs are canonicalized and deduplicated before extraction.
- Metadata prefetch reuses existing article metadata by canonical URL when available.
- Clustering is precision-first and may leave uncertain sources unclustered.
- Article upserts use conflict key `(publisher_id, canonical_url)`.

## Common Changes
- Model/threshold adjustments: update `constants.ts`.

## Verification
- Run `npm run workflow:console`.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- This module assumes server-side service-role DB access where the workflow touches Supabase.
