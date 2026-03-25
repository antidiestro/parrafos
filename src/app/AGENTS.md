# AGENTS Guide (`src/app/`)

## Scope
- Applies to `src/app/**` including admin routes and API handlers.

## Read These First
- `src/app/README.md`
- `src/app/admin/README.md` (for admin changes)
- `src/lib/auth/README.md` (for auth/session changes)
- `src/lib/data/README.md` (for read-model changes)

## Where to Implement Changes
- Route rendering/UI composition: `src/app/**`
- Mutating admin behavior: server actions under `src/app/admin/*-actions.ts`
- Shared business logic: `src/lib/**` (do not duplicate in route files)

## Guardrails
- Validate untrusted request/form input.
- Keep admin mutations protected with `requireAdminSession()`.
- Revalidate paths after successful mutations where UI depends on cached data.

## Mandatory Documentation Update Policy
- If you modify route behavior, admin flows, action contracts, or API request/response expectations, update the relevant co-located docs (`src/app/README.md`, `src/app/admin/README.md`, and any impacted `src/lib/*/README.md`) in the same change.

## Validation
- `npm run dev` and manually verify impacted routes.
- `npm run lint`
- `npx tsc --noEmit`
