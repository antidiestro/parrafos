# `src/lib/data`

## Purpose
- Centralized query layer for read operations used by pages and scripts.

## Key Files
- `briefs.ts`: latest published brief + ordered `brief_sections` (one markdown section per story), hydrated with linked stories and source metadata. Each linked primary story’s `markdown` / `detail_markdown` columns hold the same **stringified structured story-summary JSON** produced by the pipeline (not prose markdown). For the homepage sidebar, `getLatestPublishedBriefWithStories` defensively parses that JSON and attaches **`longSummaryText`** (the pipeline’s long `summary` field, or `null` if parse/`summary` is missing). Source rows include **`published_at`** and **`extracted_at`** from `articles` for recency sorting. The same read model now includes `secondaryStories` from `stories` rows where `tier = 'secondary'`, hydrated with `sources` as well (for inline source pills and sources-only sidebar in that list). The pipeline now persists metadata-only `articles` rows for selected secondary sources, so these secondary source lists do not depend on prior extraction runs. **`sortBriefSectionsByMedianSourceRecency`** reorders sections for the homepage only (scripts keep `getLatestPublishedBriefWithStories`’s stored `position` order). `touchLatestPublishedBriefPublishedAt` updates `published_at` on that same latest published brief (used when the console novelty gate skips regeneration).
- `publishers.ts`: list configured publishers.

## Contracts and Invariants
- Query helpers throw on Supabase errors instead of returning partial failure objects.
- Return types are explicit and stable for UI consumers.
- Sorting/default limits are part of the API contract:
  - briefs by `published_at`/`created_at`
  - publishers by `name`
- `getLatestPublishedBriefWithStories` returns sections in **`brief_sections.position`** order (pipeline / relevance order), then joins linked stories, `story_articles`/`articles` (including `publisher_id`, `published_at`, `extracted_at`), and `publishers.name` so each source row has favicon URL, title, URLs, and **publisher_name** for the homepage sources sidebar. `story_articles` rows are ordered by `article_id` for a stable sidebar list. Each section in the returned bundle includes **`longSummaryText`** for the sidebar long read. It also returns `secondaryStories` ordered by `stories.position` where `tier = 'secondary'`, each with hydrated `sources` from the same `story_articles`/`articles` join path. The homepage applies **`sortBriefSectionsByMedianSourceRecency`** so the main column lists clusters by **median per-source recency, most fresh first** (`published_at` when set, else `extracted_at` per source).

## Common Changes
- Add a new read model: create a new file in `data/` and keep output shape typed.
- Change sorting/filters: update function docs and all dependent pages.

## Verification
- Load routes depending on changed query functions.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- These helpers currently use service-role client; revisit if stricter RLS client-context access is needed.
