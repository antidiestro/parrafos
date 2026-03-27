# `src/lib/runs`

## Purpose
- Shared run-domain contracts and persistence helpers used by the workflow console pipeline.

## Key Files
- `constants.ts`: run-model defaults and thresholds used by workflow stages.
- `workflow.ts`: canonical workflow stage IDs.
- `progress.ts`: metadata helpers and run-progress value parsing.
- `brief-retry.ts`: run-detail eligibility helpers retained for run payload analysis.
- `persistence/progress-repo.ts`: writes normalized progress rows (`run_publishers_progress`, `run_articles_progress`, `run_errors`).
- `persistence/stages-repo.ts`: writes stage attempt lifecycle rows in `run_stage_executions`.
- `persistence/events-repo.ts`: append-only operational timeline in `run_events`.
- `persistence/story-summaries-repo.ts`: publish-stage checkpoint persistence in `run_story_summaries`.

## Run Lifecycle Contract
- Status progression: `running` -> `completed` or `failed` for workflow console initiated runs.
- `runs.metadata` can hold diagnostic snapshots, while normalized tables remain the source of granular progress data.
- Publish checkpoints are persisted in `run_story_summaries` and final output tables (`briefs`, `stories`, `brief_paragraphs`, `story_articles`).

## Data and Extraction Invariants
- Candidate URLs are canonicalized and deduplicated before extraction.
- Metadata prefetch reuses existing article metadata by canonical URL when available.
- Clustering is precision-first and may leave uncertain sources unclustered.
- Article upserts use conflict key `(publisher_id, canonical_url)`.

## Common Changes
- Model/threshold adjustments: update `constants.ts`.
- Stage identity or sequencing contracts: update `workflow.ts`.
- Progress write semantics: update `persistence/*`.

## Verification
- Run `npm run workflow:console`.
- Confirm run lifecycle rows and stage artifacts are persisted as expected.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- This module assumes server-side service-role DB access.
