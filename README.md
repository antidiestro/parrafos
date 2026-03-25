# Parrafos

TypeScript library code and **Supabase** migrations for Parrafos: editorial **briefs** and **stories**, plus an extraction pipeline (**publishers**, **runs**, **articles**) with row-level security.

## Prerequisites

- **Node.js** (current LTS) and npm
- **Docker Desktop** (or another Docker engine) for [local Supabase](https://supabase.com/docs/guides/local-development)

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy the example file and fill in values:

```bash
cp .env.example .env
```

| Variable | Purpose |
| -------- | ------- |
| `SUPABASE_URL` | Project API URL (`http://127.0.0.1:54321` locally, or `https://<ref>.supabase.co` in production) |
| `SUPABASE_ANON_KEY` | Public **anon** key (browser and user-facing APIs; RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role** key — **server-side only** (workers, admin scripts; bypasses RLS). Never commit it or ship it to the client. |
| `SUPABASE_PROJECT_REF` | Optional: project reference ID, for `npm run update-types` against a hosted project |

### 3. Local database (Docker)

Start the stack (applies migrations and `supabase/seed.sql`):

```bash
npx supabase start
```

Print credentials in `.env`-friendly form:

```bash
npx supabase status -o env
```

Use **`API_URL`** as `SUPABASE_URL`, **`ANON_KEY`** as `SUPABASE_ANON_KEY`, and **`SERVICE_ROLE_KEY`** as `SUPABASE_SERVICE_ROLE_KEY` in your `.env`.

Useful URLs:

- **Studio** (table editor, SQL): http://127.0.0.1:54323  
- **API**: http://127.0.0.1:54321  

Stop local Supabase when finished:

```bash
npx supabase stop
```

Reset the local DB and re-run all migrations from scratch:

```bash
npx supabase db reset
```

### 4. Hosted Supabase

Create a project in the [Supabase dashboard](https://supabase.com/dashboard), then link the repo and push migrations:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

Set `SUPABASE_URL` and keys from **Project Settings → API**.

## TypeScript

### Check types

```bash
npx tsc --noEmit
```

### Regenerate DB types for `supabase-js`

Types should match the live schema. See [Generating TypeScript types](https://supabase.com/docs/guides/api/rest/generating-types).

**Local** (requires `npx supabase start`):

```bash
npm run update-types:local
```

**Hosted project** (set `SUPABASE_PROJECT_REF` and authenticate with `npx supabase login`):

```bash
npm run update-types
```

Output is written to `src/database.types.ts`. The Supabase helpers use `createClient<Database>(...)`.

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
| `supabase/migrations/` | SQL migrations (schema + RLS) |
| `supabase/seed.sql` | Optional seed data after `db reset` |
| `supabase/config.toml` | Local Supabase CLI configuration |
| `src/database.types.ts` | Generated (or hand-maintained) `Database` type for PostgREST |
| `src/lib/supabase/` | Thin typed wrappers around `@supabase/supabase-js` |

## Data model (short)

- **Briefs** → **stories** (ordered blocks; Markdown body).
- **Story ↔ article** links live in **`story_articles`** (sources are **`articles.canonical_url`**).
- **Publishers** are crawled on **runs**; each fetch creates/updates **articles** (one row per publisher + canonical URL; re-fetch upserts).

RLS: anonymous users can read **published** briefs and related stories; **authenticated** users can manage editorial tables and read articles/runs for linking. Writes to ingestion-heavy paths are intended to use the **service role** on the server.

---

More on the CLI: [Supabase CLI](https://supabase.com/docs/guides/cli).
