# `src/app/admin`

## Purpose
- Admin-only UI for managing publishers and queueing extraction runs.
- Hosts server actions for authenticated mutations.

## What Lives Here
- `page.tsx`: publisher management dashboard.
- `publisher-actions.ts`: create/update/delete publishers.
- `runs/page.tsx` and `runs/run-actions.ts`: queue runs and inspect status.
- `runs/[runId]/page.tsx`, `runs/[runId]/data/route.ts`, and `runs/[runId]/cancel/route.ts`: run detail view with polling-backed live progress, persisted story-cluster visibility, article drill-down, cancel control, a callout explaining whether admin brief retry is available (and why not), and (for eligible failed runs) retry of brief generation via `retryBriefGenerationAction` in `runs/run-actions.ts`.
- `login/*`: login/logout flow and session cookie management hooks.

## Key Contracts and Invariants
- Every mutating server action must call `requireAdminSession()`.
- Mutations should revalidate affected routes (`/admin`, `/admin/runs`, `/` when needed).
- Validation belongs in actions (Zod) before database writes.

## Common Changes
- Publisher form/action changes: update UI component + matching action contract.
- Run queue behavior changes: update `runs/run-actions.ts`, then align with worker/runs docs.
- Admin navigation changes: keep links between `/admin`, `/admin/runs`, and `/`.

## Verification
- Login with admin credentials, perform create/edit/delete publisher flow.
- Queue a run from `/admin/runs`.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- `/admin/runs` queues work only; it does not execute extraction itself.
- `/admin/runs/[runId]` uses polling (not subscriptions), so UI freshness depends on server-side run metadata updates.
- Run detail timestamps (`run-detail-client.tsx`) use a fixed `en-US` locale so server-rendered HTML matches the browser during hydration (`Intl` default locale differs between Node and the user agent).
- Do not bypass auth checks in actions even if middleware protects routes.
