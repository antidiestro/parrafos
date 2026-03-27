# AGENTS Guide (`src/app/`)

## Scope
- Applies to `src/app/**` including public routes and API handlers.

## Read These First
- `src/app/README.md`
- `src/lib/data/README.md` (for read-model changes)

## Where to Implement Changes
- Route rendering/UI composition: `src/app/**`
- Shared business logic: `src/lib/**` (do not duplicate in route files)

## Guardrails
- Validate untrusted request/form input.
- Revalidate paths after successful mutations where UI depends on cached data.

## Mandatory Documentation Update Policy
- If you modify route behavior, action contracts, or API request/response expectations, update the relevant co-located docs (`src/app/README.md` and any impacted `src/lib/*/README.md`) in the same change.

## Validation
- `npm run dev` and manually verify impacted routes.
- `npm run lint`
- `npx tsc --noEmit`
