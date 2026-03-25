# `src/app/admin`

## Purpose
- Admin-only UI for managing publishers and queueing extraction runs.
- Hosts server actions for authenticated mutations.

## What Lives Here
- `page.tsx`: publisher management dashboard.
- `publisher-actions.ts`: create/update/delete publishers.
- `runs/page.tsx` and `runs/run-actions.ts`: queue runs and inspect status.
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
- Do not bypass auth checks in actions even if middleware protects routes.
