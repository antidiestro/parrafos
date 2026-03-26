# `src/app`

## Purpose
- Next.js App Router entrypoints (public pages, admin pages, and API routes).
- Keep route-level concerns here: rendering, form wiring, server action invocation, and route handler input/output validation.

## What Lives Here
- `page.tsx`: public homepage (`/`), reads latest published brief + stories and shows an `Updated at HH:MM` timestamp.
- `admin/`: admin UI and server actions for publishers and runs.
- `api/gemini/generate/route.ts`: internal API endpoint for text generation.

## Key Contracts and Invariants
- Public content is read from server-side code and should never expose privileged keys.
- Admin routes are protected by middleware and server-side session checks (`src/middleware.ts` and `src/lib/auth/require-admin.ts`).
- Route handlers validate untrusted input before calling domain logic.

## Common Changes
- Add a new page: create a new route segment and pull data from `src/lib/data`.
- Add admin functionality: prefer server actions in `src/app/admin/*-actions.ts`, then wire from forms/components.
- Add an API route: validate request body with Zod and return structured errors.

## Verification
- `npm run dev` and manually test affected routes.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- Do not import service-role helpers into client bundles.
- Keep business logic in `src/lib/*`; route files should stay thin.
