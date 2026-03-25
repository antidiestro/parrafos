# `src/lib/extract`

## Purpose
- Low-level extraction utilities for fetching and cleaning HTML before LLM parsing.

## Key Files
- `fetch.ts`: resilient HTML fetch with timeout, retries, redirect follow, content-type guard, and max-size guard.
- `html.ts`: strips non-content nodes and compresses/truncates HTML for model input.

## Contracts and Invariants
- `fetchHtmlWithRetries(url)` returns:
  - `finalUrl` (after redirects)
  - `html`
  - `status`
- Non-HTML responses and oversized payloads are rejected.
- `cleanHtmlForLLM` returns bounded text to reduce token/cost risk.
- Retry behavior can be overridden by callers. Run orchestration (`src/lib/runs/process.ts`) explicitly sets `retries: 0` for fail-fast fetch attempts while still using best-effort item-level error handling.

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
