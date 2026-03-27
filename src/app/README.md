# `src/app`

## Purpose
- Next.js App Router entrypoints (public pages and API routes).
- Root layout (`layout.tsx`): site `metadata.title` is **Párrafos.com**; loads **STIX Two Text** from Google Fonts (`next/font/google`) as the default UI font (Latin + Latin extended subsets).
- Global base styles (`globals.css`): warm muted newsprint-style page background via `:root { --paper: #ebe6dc }` on `html` and `body` (components like source favicon rims can use `var(--paper)` to match).
- Keep route-level concerns here: rendering, form wiring, server action invocation, and route handler input/output validation.

## What Lives Here
- `page.tsx`: public homepage (`/`), reads latest published brief + ordered brief sections; footer area links to Ko-fi (`ko-fi.com/L4L71WRTKN`) with the standard Ko-fi button image via `next/image` (host `storage.ko-fi.com` is allowlisted in root `next.config.ts`). Above the greeting, a separate line shows **Actualizado a las HH:MM** from `created_at` (`es` locale, 24h) in smaller gray sans-serif (`font-sans text-sm text-zinc-500`). The greeting follows, framed as **los Párrafos** (product name) plus a time-of-day phrase from the same timestamp (`de esta tarde`, `de la mañana del D de mes`, etc.). The main column uses generous top/bottom padding; the greeting uses `text-2xl` and brief-section prose uses `text-lg` via `StoryMarkdown`; sections are spaced farther apart in `BriefViewer`.
- `api/gemini/generate/route.ts`: internal API endpoint for text generation.

## Key Contracts and Invariants
- Public content is read from server-side code and should never expose privileged keys.
- Route handlers validate untrusted input before calling domain logic.

## Common Changes
- Add a new page: create a new route segment and pull data from `src/lib/data`.
- Add an API route: validate request body with Zod and return structured errors.
- Homepage brief UX: render each brief section’s markdown from `brief_sections`; story detail modal content comes from linked `stories.detail_markdown`.

## Verification
- `npm run dev` and manually test affected routes.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- Do not import service-role helpers into client bundles.
- Keep business logic in `src/lib/*`; route files should stay thin.
