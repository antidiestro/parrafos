# `src/lib`

## Purpose
- Shared server-side domain logic for data access, auth, extraction, and integrations.
- `src/app` and `src/scripts` should call into this layer instead of duplicating logic.

## Module Map
- `data/`: query helpers for briefs, publishers, runs.
- `auth/`: admin session token and server-side enforcement.
- `runs/`: orchestration of extraction runs.
- `extract/`: network fetch + HTML cleanup for extraction.
- `supabase/`: typed client factories and env accessors.
- `gemini/`: Gemini client + text/JSON generation wrappers.

## Dependency Direction
- Preferred flow: app/scripts -> `lib/runs` or `lib/data` -> integration modules (`lib/supabase`, `lib/gemini`, `lib/extract`).
- Keep cross-module contracts explicit and typed.

## Common Changes
- Add a new DB query: extend `lib/data/*`.
- Add extraction behavior: update `lib/runs` and/or `lib/extract`.
- Add integration settings: update `lib/supabase` or `lib/gemini` env/client modules.

## Verification
- Run focused scenario (admin route, worker, or homepage depending on change).
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- Service-role code is server-only.
- Avoid embedding route/UI logic in `lib`.
