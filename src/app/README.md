# `src/app`

## Purpose
- Next.js App Router entrypoints (public pages and API routes).
- Root layout (`layout.tsx`) loads **STIX Two Text** from Google Fonts (`next/font/google`) as the default UI font (Latin + Latin extended subsets).
- Global base styles (`globals.css`): warm muted newsprint-style page background via `:root { --paper: #ebe6dc }` on `html` and `body` (components like source favicon rims can use `var(--paper)` to match).
- Keep route-level concerns here: rendering, form wiring, server action invocation, and route handler input/output validation.

## What Lives Here
- `page.tsx`: public homepage (`/`), reads latest published brief + ordered brief paragraphs and opens with a Spanish greeting framed as **los Párrafos** plus a time-of-day phrase from the brief timestamp (`de esta tarde`, `de la mañana del D de mes`, etc.) and `actualizados a las HH:MM` (`es` locale).
- `api/gemini/generate/route.ts`: internal API endpoint for text generation.

## Key Contracts and Invariants
- Public content is read from server-side code and should never expose privileged keys.
- Route handlers validate untrusted input before calling domain logic.

## Common Changes
- Add a new page: create a new route segment and pull data from `src/lib/data`.
- Add an API route: validate request body with Zod and return structured errors.
- Homepage brief UX: keep paragraph rendering sourced from `brief_paragraphs` and story detail modal content sourced from linked `stories.detail_markdown`.

## Verification
- `npm run dev` and manually test affected routes.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- Do not import service-role helpers into client bundles.
- Keep business logic in `src/lib/*`; route files should stay thin.
