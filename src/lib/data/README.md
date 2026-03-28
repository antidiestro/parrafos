# `src/lib/data`

## Purpose
- Centralized query layer for read operations used by pages and scripts.

## Key Files
- `briefs.ts`: latest published brief + ordered `brief_sections` (one markdown section per story), hydrated with linked stories and source metadata. Each linked story’s `markdown` / `detail_markdown` columns hold the same **stringified structured story-summary JSON** produced by the pipeline (not prose markdown). For the homepage sidebar, `getLatestPublishedBriefWithStories` defensively parses that JSON and attaches **`longSummaryText`** (the pipeline’s long `summary` field, or `null` if parse/`summary` is missing). `touchLatestPublishedBriefPublishedAt` updates `published_at` on that same latest published brief (used when the console novelty gate skips regeneration).
- `publishers.ts`: list configured publishers.

## Contracts and Invariants
- Query helpers throw on Supabase errors instead of returning partial failure objects.
- Return types are explicit and stable for UI consumers.
- Sorting/default limits are part of the API contract:
  - briefs by `published_at`/`created_at`
  - publishers by `name`
- `getLatestPublishedBriefWithStories` reads from `brief_sections` for homepage section order (relevance selection order from the publish pipeline), then joins linked stories, `story_articles`/`articles` (including `publisher_id`), and `publishers.name` so each source row has favicon URL, title, URLs, and **publisher_name** for the homepage sources sidebar. `story_articles` rows are ordered by `article_id` for a stable sidebar list. Each section in the returned bundle includes **`longSummaryText`** for the sidebar long read.

## Common Changes
- Add a new read model: create a new file in `data/` and keep output shape typed.
- Change sorting/filters: update function docs and all dependent pages.

## Verification
- Load routes depending on changed query functions.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- These helpers currently use service-role client; revisit if stricter RLS client-context access is needed.
