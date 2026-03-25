# Parrafos

TypeScript library code and **Supabase** migrations for Parrafos: editorial **briefs** and **stories**, plus an extraction pipeline (**publishers**, **runs**, **articles**) with row-level security.

A **Next.js** app in `src/app` reads the database with **server-only** Supabase (`SUPABASE_SERVICE_ROLE_KEY`); the public homepage shows the latest published brief, and **/admin** (guarded by `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` in `.env`) manages publishers.

This repo is set up to **develop against your hosted Supabase project** (e.g. production). You use the **Supabase CLI** for migrations and type generation; **Docker is not required** for that workflow.

The `/admin/runs` page only **queues** runs. A worker process must be running to execute queued runs.

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

Run the web app locally (after `.env` is filled, including admin vars):

```bash
npm run dev
```

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
| `SUPABASE_URL` | **Project URL** (e.g. `https://xxxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | **anon public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | **service_role** key — **server-side only**; never commit or expose to browsers |
| `SUPABASE_PROJECT_REF` | Same as the project ref you used in `supabase link`; required for `npm run update-types` |

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

## Runs worker

Queue runs in `/admin/runs`, then execute them with:

```bash
npm run worker:runs
```

Run a single queued job and exit:

```bash
npm run worker:runs -- --once
```

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
const admin = createSupabaseServiceClientFromEnv()
```

In **browser** or frameworks that inject public env vars, pass the URL and anon key explicitly:

```ts
import { createSupabaseAnonClient } from './src/lib/supabase/client'

const supabase = createSupabaseAnonClient(url, anonKey)
```

Do **not** import `createSupabaseServiceClient` (or the service env helpers) from client bundles.

## Repository layout

| Path | What it is |
| ---- | ---------- |
| `supabase/migrations/` | SQL migrations (schema + RLS), applied with `npm run db:push` |
| `supabase/seed.sql` | Used only if you run a **local** `supabase db reset` (optional) |
| `supabase/config.toml` | CLI defaults; linking stores remote connection metadata under `supabase/.temp/` (gitignored) |
| `src/database.types.ts` | Generated `Database` type for PostgREST |
| `src/lib/supabase/` | Thin typed wrappers around `@supabase/supabase-js` |

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
