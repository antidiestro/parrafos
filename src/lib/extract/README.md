# `src/lib/extract`

## Purpose
- Low-level extraction utilities for fetching HTML, deterministic candidate/metadata parsing, and LLM text cleanup.

## Key Files
- `fetch.ts`: resilient HTML fetch with timeout, retries, redirect follow, and content-type guard.
- `html.ts`: strips non-content nodes and returns bounded HTML/text variants for model input.
- `article-candidates.ts`: deterministic homepage candidate discovery and article metadata extraction from JSON-LD/meta tags.

## Contracts and Invariants
- `fetchHtmlWithRetries(url)` returns:
  - `finalUrl` (after redirects)
  - `html`
  - `status`
- Non-HTML responses are rejected.
- `extractArticleCandidatesFromHomepage(baseUrl, html)`:
  - resolves relative links against `baseUrl`,
  - keeps only URLs whose pathname has at least 3 non-empty segments,
  - canonicalizes URLs and returns up to 15 candidates.
- `extractArticleMetadata(articleUrl, html)`:
  - first tries `application/ld+json` entries of type `NewsArticle`/`Article` (including arrays and `@graph`),
  - falls back to meta tags only when `article:published_time` exists,
  - extracts `description` from JSON-LD (`description`/`abstract`) or from meta tags (`og:description`, `twitter:description`, `description`) when available,
  - returns `null` when neither source provides required metadata contract.
- Run orchestration (`src/lib/runs/process.ts`) uses metadata extraction as an early gate: all identified candidates are metadata-validated before clustering/relevance selection.
- `cleanTextForLLM` returns bounded plain text for body-text extraction prompts.
- Retry behavior can be overridden by callers. Run orchestration (`src/lib/runs/process.ts`) explicitly sets `retries: 0` for fail-fast fetch attempts while still using best-effort item-level error handling.

## Worker Logging (Observability)
- `fetchHtmlWithRetries` logs each attempt, failures, and the final status/url (without dumping full HTML).
- `cleanTextForLLM` logs input/collapsed/output character counts and truncation.

## Common Changes
- Tuning crawl behavior: modify timeout/retry settings in `fetch.ts`.
- Improving model input quality: adjust cleanup selectors and max characters in `html.ts`.

## Verification
- Run a single worker job against known publishers.
- Confirm extraction still succeeds for typical homepage/article pages.
- `npm run lint`

## Gotchas
- Aggressive cleanup can remove article body content; test on multiple sites.
- Retry policies affect total run latency significantly.
