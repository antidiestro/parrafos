# `src/lib/runs`

## Purpose
- Coordinates the extraction pipeline lifecycle for queued runs.

## Key Files
- `process.ts`
  - thin orchestration entrypoint that exports the public run API:
    - `claimNextPendingRun()`
    - `processRun(runId)`
    - `retryBriefGenerationForFailedRun(runId)`
    - `retryFailedExtractionsForFailedRun(runId)`
    - `regenerateStorySummariesForRun(runId)`
    - `regenerateBriefParagraphsForRun(runId)`
- `process/claim.ts`
  - pending-run claiming logic (`runs.pending` -> `runs.running`).
- `process/retry-ops.ts`
  - failed-run retry flows for brief publication and extraction retries.
  - manual publish-stage regeneration for terminal runs:
    - `regenerateStorySummariesForRun(runId)`: reruns only `generate_story_summaries`, refreshes `run_story_summaries`, and clears paragraph checkpoint.
    - `regenerateBriefParagraphsForRun(runId)`: reruns `compose_brief_paragraphs`, then `persist_brief_output`, and marks the run `completed`.
- `process/context.ts`
  - mutable in-memory workflow context for a single `processRun()` execution.
- `process/shared.ts`
  - shared run utilities and contracts used across stages and retries (logging, cancellation/progress updates, URL canonicalization, brief publication, extraction helpers, and shared process types).
- `process/stage-discover-candidates.ts`
  - stage implementation for `discover_candidates`.
- `process/stage-prefetch-metadata.ts`
  - stage implementation for `prefetch_metadata` (including local bounded-concurrency mapping helper).
- `process/stage-cluster-and-select.ts`
  - stage implementations for `cluster_sources` and `select_clusters`, including cluster persistence, eligibility marking, and relevance selection helpers.
- `process/stage-extract-bodies.ts`
  - stage implementation for `extract_bodies`, including local existing-article lookup helper.
- `process/stage-upsert-articles.ts`
  - stage implementation for `upsert_articles`.
- `process/stage-generate-story-summaries.ts`
  - stage implementation for `generate_story_summaries`.
- `process/stage-compose-brief-paragraphs.ts`
  - stage implementation for `compose_brief_paragraphs`.
- `process/stage-persist-brief-output.ts`
  - stage implementation for `persist_brief_output`.
- `process/publish-brief.ts`
  - helper module for publish-stage internals: summary generation, brief composition, and persistence writes.
- `brief-retry.ts`: `getBriefRetryAvailability(payload)` explains whether admin brief retry applies and why not; `canRetryBriefGeneration(payload)` is true when availability is `available` (selected clusters present, extracted body text per selected story; uses `briefArticleBodyKeys` from the run detail payload so `skipped_existing` sources still count when bodies live on other runs’ article rows). It also exposes extraction-retry availability helpers for failed runs.
- `constants.ts`: run model defaults used in identification, clustering, relevance selection, and extraction.
- `progress.ts`: shared metadata types and parsing helpers for run-progress read models/UI.
- `persistence/progress-repo.ts`: persists normalized progress rows and run summary counters (`run_publishers_progress`, `run_articles_progress`, `run_errors`).
- `persistence/stages-repo.ts`: stage attempt bookkeeping in `run_stage_executions` with heartbeat and status transitions.
- `persistence/events-repo.ts`: append-only operational timeline in `run_events`.
- `persistence/story-summaries-repo.ts`: publish-stage checkpoint persistence in `run_story_summaries`.
- `workflow.ts`: canonical stage IDs used by runtime and persistence.

## Worker Logging (Observability)
- `process.ts` emits `console.log` output with the prefix `[worker:runs]` for major lifecycle stages and per-item outcomes.
- Logs include `runId` context, publisher start/finish + candidate counts, article queued/skipped, extraction success/failure, and article upsert results.
- Top-level `processRun: fatal error` logs now include serialized error details (name/message/stack/cause) instead of only a flattened message.
- `prefetch_metadata` failure logs include the candidate URL, the last attempted URL, and serialized error details (name/message/stack/cause) for fetch diagnostics.
- `prefetch_metadata` existing-article DB lookup failures now log chunk context (chunk index/size + canonical URL sample) and include PostgREST fields (`code`, `details`, `hint`, `status`) in the thrown fatal error message.
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
- Publish stage checkpoints are persisted in `runs.metadata.publish`:
  - `brief_paragraphs`
- Story-summary checkpoints are persisted in `run_story_summaries` (latest per run-cluster, ordered by `position`).

## Data and Extraction Invariants
- Candidate article URLs are canonicalized and deduplicated before fetch.
- Candidate identification is capped at 20 URLs per publisher homepage before metadata prefetch.
- Candidate identification is deterministic (no LLM): homepage `<a href>` URLs are resolved/canonicalized and must have at least 3 pathname segments.
- Article metadata validation is deterministic (no LLM): JSON-LD `NewsArticle`/`Article` is preferred; meta tags are only used when `article:published_time` exists.
- All identified candidates go through a deterministic metadata prefetch stage before clustering.
- Metadata prefetch first checks `articles` for an existing `canonical_url` match derived from the identified URL; when found, it reuses persisted metadata (`canonical_url`, `title`, `published_at`, `source_url`) and skips live URL fetch.
- Existing-article metadata lookups are chunked by both item count and encoded URL length to avoid oversized `.in()` query URLs that can overflow HTTP header limits.
- Canonical URL cache matching assumes canonical URLs do not overlap across publishers.
- Metadata prefetch normalizes timezone-less publish timestamps with `RUN_PUBLISHED_AT_FALLBACK_TIMEZONE` (default `America/Santiago`), then keeps only candidates published in the last 24 hours for clustering; older/missing-date candidates are marked `not_selected_for_extraction`.
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
- Relevant-story selection explicitly ignores routine day-to-day crime unless impact is extraordinary, and only allows sports when the event is clearly history-making.
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
  7. commit extracted article upserts in a single bulk write (`onConflict: publisher_id,canonical_url`) per stage run.
- After extracting selected sources, publish work runs in three explicit stages:
  - `generate_story_summaries`: generates one extended summary per selected cluster and checkpoints in `run_story_summaries`.
  - `compose_brief_paragraphs`: generates one coherent paragraph per checkpointed summary and checkpoints in `metadata.publish.brief_paragraphs`.
  - `persist_brief_output`: writes `briefs`, `stories`, `brief_paragraphs`, and `story_articles`.
- Story summaries and brief paragraphs are generated in Spanish only.
- Story summaries and brief paragraphs use a skeptical but balanced editorial tone: they may flag source bias and potential official agendas while avoiding conspiratorial framing, and prompts require strictly objective, fact-grounded wording (no value-laden framing or listed subjective Spanish terms).
- Story-summary and brief-paragraph prompts include an explicit current timestamp reference ("now") that the model should use for recency-based writing criteria.
- Brief paragraphs are generated as single markdown paragraphs of exactly 4 sentences each, and each paragraph starts with a short inline bold title ending in a period (for example, `**Título breve.**`), while maintaining flow between adjacent paragraphs.
- The inline bold short title must reflect the latest concrete development of each story, not the overall long-running theme.
- Brief paragraph emphasis is recency-weighted: writing should prioritize newer verified developments by paying attention to publication timestamps referenced in the input summaries.
- Story summaries are generated as Spanish Markdown with a clear journalistic structure and can mix short sections and bullets; strict section-count/bullet-count validation is not enforced, but summaries must remain source-grounded and only use selected-cluster source URLs when adding links.
- Publish-stage text normalizes common HTML/numeric entities back into UTF-8 characters before persistence (helps preserve Spanish accents/diacritics).
- Failed brief retries restart from the failed publish sub-stage when required checkpoints are available.
- Manual regenerate controls are terminal-run only (`failed`, `completed`, `cancelled`) to avoid racing active worker execution:
  - Story-summary regeneration does not auto-run paragraph composition/persistence.
  - Brief-paragraph regeneration requires an existing story-summary checkpoint and persists output immediately.
- `discover_candidates` processes publishers in parallel (one concurrent task per configured publisher host) so homepage fetch and deterministic candidate discovery run simultaneously across sites.
- Bounded concurrency is controlled with `RUN_EXTRACT_CONCURRENCY` (default `5`, minimum `1`, max `20`) for metadata prefetch; prefetch scheduling is host-aware (global cap + per-host isolation, currently 1 in-flight request per host) to prevent single-host contention from dominating the worker pool; body-text extraction calls are intentionally sequential.
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
