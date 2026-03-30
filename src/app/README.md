# `src/app`

## Purpose
- Next.js App Router entrypoints (public pages).
- Root layout (`layout.tsx`): site `metadata.title` is **Párrafos**; `description` is **Para quedar al día en un par de minutos.**; **`metadata.icons.icon`** is **`/icon.png`** (file: **`public/icon.png`**); matching **Open Graph** and **Twitter** (`summary_large_image`) tags, **`og:image` / Twitter image** at **`/og-image.png`** (file: **`public/og-image.png`**); `metadataBase` comes from **`NEXT_PUBLIC_SITE_URL`** (no trailing slash; defaults to `http://localhost:3000` if unset) so crawlers get absolute image URLs; loads **STIX Two Text** from Google Fonts (`next/font/google`) as the default UI font (Latin + Latin extended subsets).
- Global base styles (`globals.css`): warm muted newsprint-style page background via `:root { --paper: #ebe6dc }` on `html` and `body` (components like source favicon rims can use `var(--paper)` to match).
- Keep route-level concerns here: rendering, form wiring, server action invocation, and route handler input/output validation.

## What Lives Here
- `page.tsx`: public homepage (`/`), reads latest published brief + ordered brief sections at **build time** (root `next.config.ts` uses `output: "export"`; content updates require a new build/deploy); **`BriefViewer` receives sections sorted by median source recency** (most fresh first via `sortBriefSectionsByMedianSourceRecency`), not raw `brief_sections.position`. Footer area links to Ko-fi (`ko-fi.com/L4L71WRTKN`) with the standard Ko-fi button image via `next/image` (host `storage.ko-fi.com` is allowlisted in root `next.config.ts`). Above the greeting, a separate line shows **Actualizado a las HH:MM** from `published_at`, or `created_at` if `published_at` is null (`es` locale, 24h, **`America/Santiago` wall time**, not the server’s default timezone) in smaller gray sans-serif (`font-sans text-sm text-zinc-500`). The greeting follows, framed as **los Párrafos** (product name) plus a time-of-day phrase from **`created_at`** in the same timezone (`de esta tarde`, `de la mañana del D de mes`, etc.; “same calendar day” vs. *ahora* is also evaluated in `America/Santiago`). The main column uses generous top/bottom padding; the greeting uses `text-2xl` and brief-section prose uses `text-lg` via `StoryMarkdown`; sections are spaced farther apart in `BriefViewer`.

## Key Contracts and Invariants
- Public content is read from server-side code and should never expose privileged keys.
- Route handlers validate untrusted input before calling domain logic.

## Common Changes
- Add a new page: create a new route segment and pull data from `src/lib/data`.
- Add an API route: validate request body with Zod and return structured errors.
- Homepage brief UX: render each brief section’s markdown from `brief_sections`; **bold** (`**…**` / `<strong>`) in that prose is an inline control styled like a link and opens the same right-hand **StorySidebar** as the sources pill. Below the prose, the sources pill also opens **StorySidebar**. The sidebar `aria-label` is **Detalle y fuentes**; the sheet uses **`max-w-3xl`** (full width on small screens) and **horizontal padding `px-6 sm:px-9`** in the header and scroll body. When `longSummaryText` is present, the **first ATX heading line** is dropped before render, then compact `StoryMarkdown` renders the rest (**`h1`–`h6`** share one style) above a **Fuentes** divider and a **compact** source list (smaller favicons, tighter rows, `line-clamp-2` titles); if that text is missing, only sources are shown. Backdrop and panel **fade/slide** on open/close; source links use `target="_blank"` and add `utm_source=parrafos.com`. The pill uses **pointer**, **black label text on hover**, **favicon opacity 75% → 100%** on hover, clears **grayscale on favicons** on hover, no outer padding, spaced default-grayscale favicons with an **inset ring** above each image and `mix-blend-multiply` on the paper background.

## Verification
- `npm run dev` and manually test affected routes.
- `npm run lint`
- `npx tsc --noEmit`

## Gotchas
- Do not import service-role helpers into client bundles.
- Keep business logic in `src/lib/*`; route files should stay thin.
