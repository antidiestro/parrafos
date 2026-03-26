# `src/lib/runs`

## Purpose
- Coordinates the extraction pipeline lifecycle for queued runs.

## Key Files
- `process.ts`
  - `claimNextPendingRun()`: atomically claims one `runs` row from `pending` to `running`.
  - `processRun(runId)`: processes all publishers, clusters identified sources into stories, selects relevant clusters, and extracts/upserts selected article sources.
  - `retryBriefGenerationForFailedRun(runId)`: when a run is `failed` but extraction and cluster selection already succeeded, runs brief generation again and sets the run to `completed` (admin-triggered).
  - `retryFailedExtractionsForFailedRun(runId)`: when a run is `failed`, retries extraction for selected-cluster sources that still lack usable body text in `articles` (including previously `skipped_existing` cases with empty body text); if brief prerequisites become valid afterward, it publishes the brief and marks the run `completed`, otherwise keeps run `failed` with an explicit unavailability message.
- `brief-retry.ts`: `getBriefRetryAvailability(payload)` explains whether admin brief retry applies and why not; `canRetryBriefGeneration(payload)` is true when availability is `available` (selected clusters present, extracted body text per selected story; uses `briefArticleBodyKeys` from the run detail payload so `skipped_existing` sources still count when bodies live on other runs’ article rows). It also exposes extraction-retry availability helpers for failed runs.
- `constants.ts`: run model defaults used in identification, clustering, relevance selection, and extraction.
- `progress.ts`: shared metadata types and parsing helpers for run-progress read models/UI.
- `persistence/progress-repo.ts`: persists normalized progress rows and run summary counters (`run_publishers_progress`, `run_articles_progress`, `run_errors`).
- `persistence/stages-repo.ts`: stage attempt bookkeeping in `run_stage_executions` with heartbeat and status transitions.
- `persistence/events-repo.ts`: append-only operational timeline in `run_events`.
- `workflow.ts`: canonical stage IDs used by runtime and persistence.

## Worker Logging (Observability)
- `process.ts` emits `console.log` output with the prefix `[worker:runs]` for major lifecycle stages and per-item outcomes.
- Logs include `runId` context, publisher start/finish + candidate counts, article queued/skipped, extraction success/failure, and article upsert results.
- Low-level HTML fetch/cleanup logs are emitted from `src/lib/extract/fetch.ts` and `src/lib/extract/html.ts`.

## Run Lifecycle Contract
- Status progression: `pending` -> `running` -> `completed` or `failed`.
- Runs may be set to `cancelled` by admin actions while pending/running.
- Critical progress/state persisted in normalized columns/tables:
  - `runs` summary/model columns (`extract_model`, `cluster_model`, `relevance_model`, counters, `current_stage`, `stage_attempt`, `last_heartbeat_at`)
  - `run_stage_executions` (per-stage attempt lifecycle)
  - `run_publishers_progress` / `run_articles_progress`
  - `run_errors`
  - `run_events`
- `runs.metadata` remains for diagnostic/backward-compatible snapshots only.
- Metadata snapshot fields still tracked during execution:
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
- Stage attempts are persisted as explicit `run_stage_executions` rows so stage progress/retries can be inspected independently of JSON snapshots.
- The worker checks for cancellation throughout processing and exits early without forcing `completed`/`failed` when a run is cancelled.

## Data and Extraction Invariants
- Candidate article URLs are canonicalized and deduplicated before fetch.
- Candidate identification is capped at 15 URLs per publisher homepage before metadata prefetch.
- Candidate identification is deterministic (no LLM): homepage `<a href>` URLs are resolved/canonicalized and must have at least 3 pathname segments.
- Article metadata validation is deterministic (no LLM): JSON-LD `NewsArticle`/`Article` is preferred; meta tags are only used when `article:published_time` exists.
- All identified candidates go through a deterministic metadata prefetch stage before clustering.
- Candidates missing both valid JSON-LD and required meta fallback are discarded before clustering.
- Body text extraction still uses LLM parsing on cleaned article text.
- Identified candidates are clustered into stories and persisted in `run_story_clusters` + `run_story_cluster_sources`.
- Clustering uses compact synthetic `source_key` values (stable short hashes) instead of raw URL-shaped identifiers to reduce prompt/response size.
- Clustering input is passed as compact plain text lines (`source_key | published_at | title`) instead of serialized JSON to reduce token overhead.
- Clustering is precision-first and sparse: uncertain sources may remain unclustered (no fallback singleton clusters).
- Clustering prompt targets 10 story clusters when evidence supports it.
- A source can be assigned to only one cluster per run.
- Cluster persistence uses a compact model contract (`title` + `source_keys`) and applies cross-publisher minimum support in code before persistence.
- Persisted clusters with fewer than 3 sources are discarded before relevance selection.
- Relevant-story selection asks for 6 clusters when at least 6 are eligible (otherwise all eligible clusters), and now scores clusters with an explicit recency/impact rubric (latest timestamps, source activity in the last 6h/24h, and deterministic article-description metadata from JSON-LD/meta).
- Selected clusters persist `selection_reason` so the writing step has explicit context for why the story is in the brief.
- Sources from selected stories that already exist in `articles` are skipped and not re-extracted.
- Article upserts use conflict key `(publisher_id, canonical_url)`.
- Critical extraction attribution now uses explicit `articles` columns (`source_url`, `extraction_model`, `clustering_model`, `relevance_selection_model`).
- Per-article failures are captured in metadata errors and do not abort the entire run.
- Top-level fatal errors mark run as `failed`.
- Admin extraction retry targets selected-cluster sources lacking usable body text, regardless of current metadata status (`failed`, `skipped_existing`, or other), so brief prerequisites can be recovered in-place for failed runs.
- Extraction uses a staged flow:
  1. fetch each homepage and identify candidate links,
  2. fetch each identified candidate URL and extract deterministic metadata (`canonical_url`, `title`, `published_at`),
  3. identify specific story clusters from metadata-validated candidates (allow unassigned uncertain sources),
  4. discard clusters with too few sources and select relevant stories,
  5. skip selected sources already present in DB,
  6. run body-text extraction sequentially (one source at a time) to avoid bursty model traffic, while reusing prefetched HTML when available,
  7. commit article upserts sequentially in input order.
- After extracting selected sources, the worker generates a published brief:
  - one Gemini summary paragraph per selected story cluster (~600 chars), via structured JSON output (`markdown` field),
  - paragraph prompts enforce a latest-first structure: newest development first, then why it matters, then minimal context,
  - persisted into `briefs` + `stories`,
  - stories are ordered by descending `run_story_clusters.source_count` (tie-breaker: newest source).
  - logs each successful cluster paragraph and the final `briefId` + story count to the console (`[worker:runs] … brief:`); Gemini JSON parse failures log raw model text under `[gemini] generateGeminiJson:` (see `src/lib/gemini/generate.ts`).
- Bounded concurrency is controlled with `RUN_EXTRACT_CONCURRENCY` (default `5`, minimum `1`, max `20`) for metadata prefetch; body-text extraction calls are intentionally sequential.
- Run orchestration currently uses no fetch retries (`retries: 0`) for both homepage and article requests.

## Common Changes
- Change deterministic candidate/metadata rules: update `process.ts` and `src/lib/extract/article-candidates.ts`.
- Change body-text extraction prompt/schema: update `process.ts` and `src/lib/gemini/README.md`.
- Change URL normalization: update `toCanonicalUrl` logic and verify dedup behavior.
- Change metadata shape: update run insertion defaults in admin run actions too.

## Verification
- Queue a run in `/admin/runs`.
- Run worker once: `npm run worker:runs -- --once`.
- Check `runs` row transitions and stage/counter columns.
- Check normalized state tables populate during execution:
  - `run_stage_executions`
  - `run_publishers_progress`
  - `run_articles_progress`
  - `run_errors`
  - `run_events`

## Gotchas
- This module assumes service-role DB access.
- Keep metadata backward-compatible if existing UI reads old keys.
