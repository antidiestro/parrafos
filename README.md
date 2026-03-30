# Parrafos

TypeScript library code and **Supabase** migrations for Parrafos: editorial **briefs** and **stories**, plus an extraction pipeline (**publishers**, **runs**, **articles**) with row-level security.

A **Next.js** app in `src/app` reads the database with **server-only** Supabase (`SUPABASE_SERVICE_ROLE_KEY`); the public homepage shows the latest published brief **as of each production build** (static export in `next.config.ts`, deployed from `out/`).

This repo is set up to **develop against your hosted Supabase project** (e.g. production). You use the **Supabase CLI** for migrations and type generation; **Docker is not required** for that workflow.

Run generation now happens through the standalone brief pipeline (`npm run generate-brief`).

> **Caution:** `supabase db push` applies migrations to the linked remote database. There is no local copy of the schema unless you add a separate staging project or use branches. Take backups or test risky changes on another project first.

## Prerequisites

- **Node.js** (current LTS) and npm
- A **Supabase** project ([dashboard](https://supabase.com/dashboard))
- [Supabase CLI](https://supabase.com/docs/guides/cli) via this repo’s devDependency (`npx supabase …`)

## Quick start

### 1. Install dependencies

```bash
npm install
```

Run the web app locally (after `.env` is filled):

```bash
npm run dev
```

`dev:all` aliases the regular dev server:

```bash
npm run dev:all
```

### Deploy to Netlify

The repo includes [`netlify.toml`](./netlify.toml) (`npm run build`, publish **`out/`**). The site is a **static export**: Netlify serves prebuilt HTML/assets only; the homepage snapshot is produced **during the build** when Next runs the server-side Supabase client. The homepage response sets **Cache-Control** with **15 minutes** (`max-age` and `s-maxage` of 900 seconds) for browsers and shared caches.

**One-time CLI setup** (from the repo root):

```bash
npm install
npx netlify login
npx netlify init   # link or create a site; pick this repo as the base directory if asked
```

In the [Netlify UI](https://app.netlify.com/) → your site → **Site configuration → Environment variables**, add at least **`SUPABASE_URL`** and **`SUPABASE_SERVICE_ROLE_KEY`** (same values as in `.env`). The build needs them so Next can prerender the homepage with the then-current published brief; changing content on Supabase does not update the live site until the next deploy.

**Deploy from your machine**:

```bash
npm run deploy:netlify         # production (live URL)
npm run deploy:netlify:draft   # draft deploy (shareable preview URL)
```

Alternatively, connect the Git repository in Netlify and use **Builds**; the same `netlify.toml` applies.

### 2. Link the CLI to your hosted project

One-time per machine (uses a [personal access token](https://supabase.com/dashboard/account/tokens)):

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

`project-ref` is the **Reference ID** under **Project Settings → General**.

### 3. Environment variables

```bash
cp .env.example .env
```

Fill `.env` from **Project Settings → API**:

| Variable | Purpose |
| -------- | ------- |
| `NEXT_PUBLIC_SITE_URL` | **Public site origin** (no trailing slash), e.g. `https://parrafos.com` or `http://localhost:3000`. Baked in at build time so **Open Graph** / social previews use absolute `og:image` URLs; set to your **production** URL on Netlify (or previews will point at the wrong host). |
| `NEXT_PUBLIC_GA_ID` | Optional. **Google Analytics 4** measurement ID (`G-…`). When set, the root layout loads GA via `@next/third-parties/google` ([Next.js guide](https://nextjs.org/docs/app/guides/third-party-libraries#google-analytics)). Omit in local/dev if you do not want analytics. |
| `SUPABASE_URL` | **Project URL** (e.g. `https://xxxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | **anon public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key — **server-side only**; never commit or expose to browsers |
| `SUPABASE_PROJECT_REF` | Same as the project ref you used in `supabase link`; required for `npm run update-types` |
| `GEMINI_API_KEY` | Google AI Studio key for Gemini requests |
| `GEMINI_MODEL` | Optional default Gemini model (defaults to `gemini-3-flash-preview`) |
| `LANGSMITH_API_KEY` | LangSmith API key for Gemini trace ingestion |
| `LANGSMITH_PROJECT` | Optional LangSmith project name (for trace organization) |
| `LANGSMITH_TRACING` | Set to `true` to emit traces |
| `LANGSMITH_GEMINI_TAGS` | Optional comma-separated tags added to Gemini traces |
| `RUN_MIN_PCT_NEW_CANDIDATES` | Optional. When set to `0`–`100`, `npm run generate-brief` exits after discovery if the percentage of discovered canonical URLs not present in the latest snapshot from a **completed** brief is below this threshold: it bumps `published_at` on the latest published brief, finalizes the run as `completed`, and exits successfully (no snapshot update). If there is no published brief, the run fails. |
| `BRIEF_SECTION_PARAGRAPH_COUNT` | Optional. Integer `1`–`3` (default `1`). Markdown paragraphs per story section in `composeBriefSections` (`generate-brief` and `regenerate-brief`). |
| `BRIEF_SECTION_CHAR_TARGET` | Optional. Soft target length in characters per paragraph (default `500`, range 50–4000). The compose prompt treats it as approximate guidance, not a strict band. |

Your app and scripts read `SUPABASE_URL` and the keys at runtime from `.env` (see below).

### 4. Apply database migrations (remote)

After you link, push local SQL migrations in `supabase/migrations/` to the linked database:

```bash
npm run db:push
```

To add a new migration:

```bash
npx supabase migration new describe_your_change
```

Edit the generated file under `supabase/migrations/`, then run `npm run db:push` again.

## TypeScript

### Check types

```bash
npx tsc --noEmit
```

### Regenerate `database.types.ts` from the hosted schema

Ensure `.env` exists (with `SUPABASE_PROJECT_REF`) and you are logged in (`npx supabase login`). The script loads `.env` via `dotenv-cli`. See [Generating TypeScript types](https://supabase.com/docs/guides/api/rest/generating-types).

```bash
npm run update-types
```

Output: `src/database.types.ts`. Use with `createClient<Database>(...)`.

## Generate brief

Run the full pipeline (discover, cluster, extract, summarize, publish) from the CLI:

```bash
npm run generate-brief
```

## Regenerate brief from latest stories

Re-run only the brief-composition step on the **current latest published** brief: reuse each story’s stored summary JSON and source article links, then insert a **new** published brief (no crawl, no new summaries, no `runs` row):

```bash
npm run regenerate-brief
```

Requires Supabase, `GEMINI_API_KEY`, and at least one published brief with sections.

## Using the Supabase clients

From Node or scripts, after `.env` is loaded (e.g. with [`dotenv`](https://github.com/motdotla/dotenv)):

```ts
import {
  createSupabaseAnonClientFromEnv,
  createSupabaseServiceClientFromEnv,
} from './src/lib/supabase/index'

// Public / user context — RLS enforced
const anon = createSupabaseAnonClientFromEnv()

// Extraction workers — only in trusted server code
const service = createSupabaseServiceClientFromEnv()
```

In **browser** or frameworks that inject public env vars, pass the URL and anon key explicitly:

```ts
import { createSupabaseAnonClient } from './src/lib/supabase/client'

const supabase = createSupabaseAnonClient(url, anonKey)
```

Do **not** import `createSupabaseServiceClient` (or the service env helpers) from client bundles.

## Repository layout

This is a lightweight map of where most changes should go:

| Path | What it is |
| ---- | ---------- |
| `src/app/` | Next.js App Router (public homepage) |
| `src/lib/` | Shared server-side domain logic (data access, runs, extract, integrations) |
| `src/lib/data/` | Query helpers used by pages and workflow observability (`briefs`, `publishers`, `runs`) |
| `src/lib/runs/` | Console brief pipeline: `console/` orchestration, `stages/`, shared `constants.ts` |
| `src/lib/extract/` | HTTP fetch/retry/size guards and HTML cleaning for model input |
| `src/lib/gemini/` | Gemini client/env wrappers and text/JSON generation helpers |
| `src/lib/supabase/` | Typed Supabase client/env helpers (anon + service role) |
| `src/scripts/` | Operational script entrypoints (`run-workflow-console.ts`, eval harnesses, etc.) |
| `src/database.types.ts` | Generated `Database` type for PostgREST |
| `supabase/migrations/` | SQL migrations (schema + RLS), applied with `npm run db:push` |
| `supabase/seed.sql` | Used only if you run a **local** `supabase db reset` (optional) |
| `supabase/config.toml` | CLI defaults; linking stores remote metadata under `supabase/.temp/` (gitignored) |
| `AGENTS.md` + nested `*/AGENTS.md` | Agent routing/instructions and documentation maintenance policy |

If you are unsure where to start, read root `AGENTS.md` and the nearest co-located `README.md` in the subtree you plan to edit.

## Data model (short)

- **Briefs** → **stories** (ordered blocks; Markdown body).
- **Story ↔ article** links live in **`story_articles`** (sources are **`articles.canonical_url`**).
- **Publishers** are crawled on **runs**; each fetch creates/updates **articles** (one row per publisher + canonical URL; re-fetch upserts).

RLS: anonymous users can read **published** briefs and related stories; **authenticated** users can manage editorial tables and read articles/runs for linking. Writes to ingestion-heavy paths are intended to use the **service role** on the server.

---

## Optional: local Supabase (Docker)

If you want a throwaway database on your machine (e.g. to test migrations before pushing), install **Docker**, then:

```bash
npx supabase start
npx supabase status -o env   # paste into a separate .env.local if you like
npx supabase db reset       # replay migrations + seed locally
npm run update-types:local  # types from local DB
npx supabase stop
```

This does **not** replace the hosted workflow above unless you choose to point your app at local URLs.

More: [Local development](https://supabase.com/docs/guides/local-development), [Supabase CLI](https://supabase.com/docs/guides/cli).
