# `src/lib/data`

## Purpose
- Centralized query layer for read operations used by pages and workflow observability.

## Key Files
- `briefs.ts`: latest published brief + ordered `brief_paragraphs`, each linked to a story summary and hydrated source metadata.
- `publishers.ts`: list configured publishers.
- `runs.ts`: list recent runs and load run detail payloads for run-progress inspection.

## Contracts and Invariants
- Query helpers throw on Supabase errors instead of returning partial failure objects.
- Return types are explicit and stable for UI consumers.
- Sorting/default limits are part of the API contract:
  - briefs by `published_at`/`created_at`
  - publishers by `name`
  - runs by `started_at desc`
- Run detail helpers (`getRunById`, `listRunArticles`, `getRunDetailPayload`) hydrate progress primarily from normalized workflow tables (`run_publishers_progress`, `run_articles_progress`, `run_errors`) and run summary columns, with `runs.metadata` as fallback.
- Run detail payload includes publish-stage story summary checkpoints from `run_story_summaries` (ordered by `position`), independent of `runs.metadata`.
- `getRunDetailPayload` returns `briefArticleBodyKeys`: publisher/canonical keys with non-empty `articles.body_text` for selected-cluster sources (globally, like brief generation), including sources marked `skipped_existing` when body text exists on prior article rows.
- `getLatestPublishedBriefWithStories` now reads from `brief_paragraphs` for homepage paragraph order, then joins linked stories (`detail_markdown`) and `story_articles`/`articles` source metadata for source pills and modal source lists.

## Common Changes
- Add a new read model: create a new file in `data/` and keep output shape typed.
- Change sorting/filters: update function docs and all dependent pages.

## Verification
- Load routes depending on changed query functions.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- These helpers currently use service-role client; revisit if stricter RLS client-context access is needed.
