# `src/lib/runs`

## Purpose
- Coordinates the extraction pipeline lifecycle for queued runs.

## Key Files
- `process.ts`
  - `claimNextPendingRun()`: atomically claims one `runs` row from `pending` to `running`.
  - `processRun(runId)`: processes all publishers, extracts article links/details, and upserts `articles`.
- `constants.ts`: run model defaults used in metadata and extraction.
- `progress.ts`: shared metadata types and parsing helpers for run-progress read models/UI.

## Run Lifecycle Contract
- Status progression: `pending` -> `running` -> `completed` or `failed`.
- Runs may be set to `cancelled` by admin actions while pending/running.
- Metadata fields tracked during execution:
  - `model`
  - `publisher_count`
  - `publishers_done`
  - `articles_found`
  - `articles_upserted`
  - `errors[]`
  - `publishers[]` per-publisher status and counters
  - `articles[]` per-article extraction/upsert status snapshots
- Progress updates are persisted during publisher and article processing so admin polling can show near-real-time state.
- The worker checks for cancellation throughout processing and exits early without forcing `completed`/`failed` when a run is cancelled.

## Data and Extraction Invariants
- Candidate article URLs are canonicalized and deduplicated before fetch.
- Article upserts use conflict key `(publisher_id, canonical_url)`.
- Per-article failures are captured in metadata errors and do not abort the entire run.
- Top-level fatal errors mark run as `failed`.
- Extraction uses a staged flow per publisher:
  1. fetch homepage and extract candidate links,
  2. run article fetch + parse in parallel with bounded concurrency,
  3. commit article upserts sequentially in input order.
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
