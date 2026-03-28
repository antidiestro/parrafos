# `src/lib/runs`

## Purpose
- **Console brief pipeline:** `console/` holds orchestration (`runConsoleWorkflow`), `republishBriefFromLatestStories` for brief-only republish, stdout logging, shared types/utils, and `pipeline-constants.ts` (Zod schemas and pipeline thresholds). Stdout from `npm run generate-brief` stays **event-granular** (including per-item lines where the pipeline already logs each step), but `console/logging.ts` formats context compactly: short timestamps, `[stage] …` markers, truncated strings/URLs, and **no large nested JSON blobs** (errors collapse to a short message, typically `code: message` when present).
- **Stages:** `stages/` implements each step (discovery, prefetch, cluster, select, extract, upsert, summaries, compose brief sections, persist brief output, persist discovery snapshot on success, run records).
- **Model config:** `constants.ts` — model IDs and recency windows used by orchestrator and stages.

## Key Files
- `constants.ts`: Gemini model IDs, recency window hours, and `parseBriefSectionComposeConstraints()` (`BRIEF_SECTION_PARAGRAPH_COUNT`, `BRIEF_SECTION_CHAR_TARGET` for the compose step). Clustering uses `RUN_CLUSTER_MODEL` (`gemini-3.1-flash-lite-preview`); the clustering prompt lists candidates as compact aliases (`c1`, `c2`, … from `clusterPromptAliasForCandidateIndex`) with each source’s headline only—no published timestamps in that prompt. The model returns a long-form `description` per story (JSON key) and source refs in `source_keys`; `clusterSources` maps refs to stable `sourceKeyFor` keys and copies each `description` onto the cluster’s `title` for downstream stages.
- `console/orchestrator.ts`: wires stages and run row lifecycle.
- `console/pipeline-constants.ts`: cluster/relevance/brief schemas and batch limits (including `clusterSportsFilterSchema` for the pre-cluster sports pass).
- `stages/run-records.ts`: creates and finalizes `runs` rows; metadata shape is inlined there.
- `stages/persist-discovery-candidates.ts`: after a **successful** pipeline, inserts the full initial discovery set into `run_discovery_candidates` (deduplicated sorted canonical URLs per run; not the selected-cluster subset).
- `stages/generate-story-summaries.ts`: LLM step that emits one **structured JSON** object per story (Zod: `simpleStorySummarySchema`); `quotes` include **`speaker_context`** (role/affiliation); **`key_facts`** are longer-form detailed items. **`story_title`** is a short Spanish headline the model writes from the sources (≤200 characters); the cluster’s long `description` is only prompt context. `StorySummaryRow.title` matches that JSON field for compose logging. The stringified JSON is stored in `stories.markdown` / `detail_markdown` and passed to compose. Summaries run in **relevance selection order** (same order as `select-clusters` output), so published `brief_sections` and `story_articles` stay aligned with each story.
- `stages/compose-brief-sections.ts`: LLM step that reads those JSON payloads and emits one markdown section per story; paragraph count and a soft per-paragraph length target come from `parseBriefSectionComposeConstraints()` (defaults: one paragraph, ~500 characters as guidance, bold lead-in on the first paragraph). Structured output uses a `sections` array (same order as the summaries). `normalizeBriefSectionMarkdown` in `console/utils.ts` turns literal `\\n` sequences into real newlines, then splits on blank lines (or single line breaks when needed) before whitespace cleanup. The model is not asked to bridge or smooth transitions between consecutive sections.
- `stages/persist-brief-output.ts`: writes `story_articles` by resolving each persisted story’s `clusterId` from `storySummaries`, not by parallel index into `selectedClusters`, so links cannot drift if array ordering ever diverges. `persistBriefOutputWithArticleIds` inserts a new published brief using explicit article UUID lists per story (used by `republishBriefFromLatestStories`).

## Run lifecycle
- The console workflow inserts a `runs` row with `status = running` **before** `discover_candidates`, so discovery can attach to `run_id`. `runs.started_at` therefore includes discovery duration.
- `run_discovery_candidates` is written only when the workflow **completes successfully**, so baselines exclude failed or abandoned runs. The stored URLs are the full `discover_candidates` output for that run (what the brief started from).
- If `RUN_MIN_PCT_NEW_CANDIDATES` is set (0–100), after discovery the workflow compares URLs to the latest prior snapshot (from the last successful run); when the share of URLs not in that baseline is below the threshold, it updates `published_at` on the latest published brief to the current time, finalizes the run as `completed`, and returns without prefetch or later stages (no new `briefs` row, no `run_discovery_candidates` insert). If no published brief exists, it throws and the run ends `failed`.
- Otherwise the workflow continues and updates `runs` to `completed` or `failed` when the pipeline finishes. If the snapshot insert fails after the brief is published, the run is still marked `completed` and the failure is logged (so a successful brief is not downgraded to `failed`).

## Extraction invariants (domain)
- Candidate URLs are canonicalized and deduplicated before extraction.
- Metadata prefetch reuses existing article metadata by canonical URL when available.
- Before clustering, `clusterSources` runs a **sports pre-filter** on `metadataReadyRecent`: Gemini `gemini-3.1-flash-lite-preview` (`RUN_EXTRACT_MODEL`) returns `remove_source_refs` (same `c1`, `c2`, … ids as the clustering prompt) for headlines that are clearly routine sports and not history-making; those candidates are dropped so they never enter clustering or `sourceByKey`. Ambiguous or non-sports lines are kept.
- Clustering assigns every remaining candidate source to exactly one run-scoped story cluster; singleton clusters are allowed, and multi-outlet groupings are kept when the model merges clearly related coverage. The clustering prompt highlights Chilean politics and international affairs (before and after the `<candidate_sources>…</candidate_sources>` block) and wraps the headline list in those tags. The clustering LLM emits `description` per story; that text becomes the cluster `title` in `ClusterDraft` and later stages. Internally, clusters still reference stable `sourceKeyFor` ids; only the LLM-facing lines use short aliases to save tokens.
- Relevance selection (`select-clusters`) only sends **multi-source** clusters (two or more articles) to the model; singleton clusters never enter that LLM call. Structured output is `selected_clusters` with `cluster_id` and `selection_reason` per item.
- Article upserts use conflict key `(publisher_id, canonical_url)`.

## Common Changes
- Model/threshold adjustments: update `constants.ts` and/or `console/pipeline-constants.ts`.
- Pipeline behavior: update `stages/*` or `console/orchestrator.ts`.

## Verification
- Run `npm run generate-brief` or `npm run regenerate-brief` (requires an existing published brief).
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- This module assumes server-side service-role DB access where the workflow touches Supabase.
