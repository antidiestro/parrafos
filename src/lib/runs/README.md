# `src/lib/runs`

## Purpose
- Coordinates the extraction pipeline lifecycle for queued runs.

## Key Files
- `process.ts`
  - `claimNextPendingRun()`: atomically claims one `runs` row from `pending` to `running`.
  - `processRun(runId)`: processes all publishers, extracts article links/details, and upserts `articles`.
- `constants.ts`: run model defaults used in metadata and extraction.

## Run Lifecycle Contract
- Status progression: `pending` -> `running` -> `completed` or `failed`.
- Metadata fields tracked during execution:
  - `model`
  - `publisher_count`
  - `publishers_done`
  - `articles_found`
  - `articles_upserted`
  - `errors[]`
- Progress updates are persisted after each publisher attempt.

## Data and Extraction Invariants
- Candidate article URLs are canonicalized and deduplicated before fetch.
- Article upserts use conflict key `(publisher_id, canonical_url)`.
- Per-article failures are captured in metadata errors and do not abort the entire run.
- Top-level fatal errors mark run as `failed`.

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
