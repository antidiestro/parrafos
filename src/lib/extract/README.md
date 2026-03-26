# `src/lib/extract`

## Purpose
- Low-level extraction utilities for fetching and cleaning HTML before LLM parsing.

## Key Files
- `fetch.ts`: resilient HTML fetch with timeout, retries, redirect follow, content-type guard, and max-size guard.
- `html.ts`: strips non-content nodes and returns bounded HTML/text variants for model input.

## Contracts and Invariants
- `fetchHtmlWithRetries(url)` returns:
  - `finalUrl` (after redirects)
  - `html`
  - `status`
- Non-HTML responses and oversized payloads are rejected.
- `cleanHtmlForLLM` returns bounded HTML content for structure-sensitive prompts.
- `cleanTextForLLM` returns bounded plain text for extraction prompts that do not need markup.
- Retry behavior can be overridden by callers. Run orchestration (`src/lib/runs/process.ts`) explicitly sets `retries: 0` for fail-fast fetch attempts while still using best-effort item-level error handling.

## Worker Logging (Observability)
- `fetchHtmlWithRetries` logs each attempt, failures, and the final status/url (without dumping full HTML).
- `cleanHtmlForLLM` and `cleanTextForLLM` log input/collapsed/output character counts and truncation.

## Common Changes
- Tuning crawl behavior: modify timeout/retry/max-bytes constants in `fetch.ts`.
- Improving model input quality: adjust cleanup selectors and max characters in `html.ts`.

## Verification
- Run a single worker job against known publishers.
- Confirm extraction still succeeds for typical homepage/article pages.
- `npm run lint`

## Gotchas
- Aggressive cleanup can remove article body content; test on multiple sites.
- Retry policies affect total run latency significantly.
