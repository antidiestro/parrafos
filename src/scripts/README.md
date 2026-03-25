# `src/scripts`

## Purpose
- Operational Node entrypoints run outside request/response lifecycle.

## Key Files
- `run-worker.ts`: claims queued runs and executes extraction pipeline continuously or once.

## Worker Behavior
- `npm run worker:runs`: infinite polling loop (2s sleep when queue is empty).
- `npm run worker:runs -- --once`: claim and process at most one pending run, then exit.
- Delegates actual run logic to `src/lib/runs/process.ts`.

## Common Changes
- Polling cadence/runtime behavior: update `run-worker.ts`.
- Extraction semantics: change `src/lib/runs` instead of this script.

## Verification
- Queue one run in admin, then execute `--once`.
- Confirm process exits cleanly and run status transitions in DB.

## Gotchas
- This script assumes `.env` is loaded by package script (`dotenv -e .env -- ...`).
- If worker is not running, queued runs remain `pending`.
