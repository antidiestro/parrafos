# `src/lib/runs`

## Purpose
- Coordinates the extraction pipeline lifecycle for queued runs.

## Key Files
- `process.ts`
  - `claimNextPendingRun()`: atomically claims one `runs` row from `pending` to `running`.
  - `processRun(runId)`: processes all publishers, clusters identified sources into stories, selects relevant clusters, and extracts/upserts selected article sources.
  - `retryBriefGenerationForFailedRun(runId)`: when a run is `failed` but extraction and cluster selection already succeeded, runs brief generation again and sets the run to `completed` (admin-triggered).
- `brief-retry.ts`: `getBriefRetryAvailability(payload)` explains whether admin brief retry applies and why not; `canRetryBriefGeneration(payload)` is true when availability is `available` (selected clusters present, extracted body text per selected story; uses `briefArticleBodyKeys` from the run detail payload so `skipped_existing` sources still count when bodies live on other runs’ article rows).
- `constants.ts`: run model defaults used in identification, clustering, relevance selection, and extraction.
- `progress.ts`: shared metadata types and parsing helpers for run-progress read models/UI.

## Worker Logging (Observability)
- `process.ts` emits `console.log` output with the prefix `[worker:runs]` for major lifecycle stages and per-item outcomes.
- Logs include `runId` context, publisher start/finish + candidate counts, article queued/skipped, extraction success/failure, and article upsert results.
- Low-level HTML fetch/cleanup logs are emitted from `src/lib/extract/fetch.ts` and `src/lib/extract/html.ts`.

## Run Lifecycle Contract
- Status progression: `pending` -> `running` -> `completed` or `failed`.
- Runs may be set to `cancelled` by admin actions while pending/running.
- Metadata fields tracked during execution:
  - `model`
  - `models`
  - `publisher_count`
  - `publishers_done`
  - `articles_found`
  - `articles_upserted`
  - `clusters_total`
  - `clusters_eligible`
  - `clusters_selected`
  - `sources_selected`
  - `errors[]`
  - `publishers[]` per-publisher status and counters
  - `articles[]` per-article extraction/upsert status snapshots
- Progress updates are persisted during publisher and article processing so admin polling can show near-real-time state.
- The worker checks for cancellation throughout processing and exits early without forcing `completed`/`failed` when a run is cancelled.

## Data and Extraction Invariants
- Candidate article URLs are canonicalized and deduplicated before fetch.
- Candidate identification attempts to include `title` and `published_at` alongside URL.
- Identified candidates are clustered into stories and persisted in `run_story_clusters` + `run_story_cluster_sources`.
- A source can be assigned to only one cluster per run.
- Clusters with fewer than 3 sources are discarded before relevance selection.
- Relevant stories are selected dynamically by model (up to a max cap).
- Sources from selected stories that already exist in `articles` are skipped and not re-extracted.
- Article upserts use conflict key `(publisher_id, canonical_url)`.
- Per-article failures are captured in metadata errors and do not abort the entire run.
- Top-level fatal errors mark run as `failed`.
- Extraction uses a staged flow:
  1. fetch each homepage and identify candidate links,
  2. cluster all identified sources into persisted story clusters,
  3. discard clusters with too few sources and select relevant stories,
  4. skip selected sources already present in DB,
  5. run article fetch + parse in parallel with bounded concurrency,
  6. commit article upserts sequentially in input order.
- After extracting selected sources, the worker generates a published brief:
  - one Gemini summary paragraph per selected story cluster (~600 chars), via structured JSON output (`markdown` field),
  - persisted into `briefs` + `stories`,
  - stories are ordered by descending `run_story_clusters.source_count` (tie-breaker: newest source).
  - logs each successful cluster paragraph and the final `briefId` + story count to the console (`[worker:runs] … brief:`); Gemini JSON parse failures log raw model text under `[gemini] generateGeminiJson:` (see `src/lib/gemini/generate.ts`).
- Bounded concurrency is controlled with `RUN_EXTRACT_CONCURRENCY` (default `5`, minimum `1`, max `20`).
- Run orchestration currently uses no fetch retries (`retries: 0`) for both homepage and article requests.

## Common Changes
- Change extraction prompts/schemas: update `process.ts` and `src/lib/gemini/README.md`.
- Change URL normalization: update `toCanonicalUrl` logic and verify dedup behavior.
- Change metadata shape: update run insertion defaults in admin run actions too.

## Verification
- Queue a run in `/admin/runs`.
- Run worker once: `npm run worker:runs -- --once`.
- Check `runs` row transitions and `metadata` fields.

## Gotchas
- This module assumes service-role DB access.
- Keep metadata backward-compatible if existing UI reads old keys.
