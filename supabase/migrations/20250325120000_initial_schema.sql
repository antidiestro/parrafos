-- Parrafos: editorial (briefs, stories) + extraction (publishers, runs, articles).
-- Article identity: one row per (publisher_id, canonical_url); re-fetches overwrite via upsert in app (no version table).

-- Enums
create type public.run_status as enum (
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
);

create type public.brief_status as enum (
  'draft',
  'published'
);

-- Publishers (news sources)
create table public.publishers (
  id uuid primary key default gen_random_uuid (),
  name text not null,
  base_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishers_base_url_key unique (base_url)
);

comment on table public.publishers is 'News sources configured for crawling.';

-- Extraction runs (global run over all publishers; progress inferred from articles + runs.status)
create table public.runs (
  id uuid primary key default gen_random_uuid (),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status public.run_status not null default 'pending',
  error_message text,
  metadata jsonb
);

comment on table public.runs is 'One scheduled extraction execution.';

create index runs_status_started_at_idx on public.runs (status, started_at desc);

-- Articles (one row per canonical URL per publisher; last extraction wins)
create table public.articles (
  id uuid primary key default gen_random_uuid (),
  publisher_id uuid not null references public.publishers (id) on delete restrict,
  run_id uuid not null references public.runs (id) on delete restrict,
  canonical_url text not null,
  title text,
  body_text text,
  extracted_at timestamptz not null default now(),
  metadata jsonb,
  constraint articles_publisher_canonical_url_key unique (publisher_id, canonical_url)
);

comment on table public.articles is 'Extracted article body from a run; upsert on same URL updates this row.';

create index articles_publisher_id_idx on public.articles (publisher_id);

create index articles_run_id_idx on public.articles (run_id);

-- Briefs
create table public.briefs (
  id uuid primary key default gen_random_uuid (),
  title text,
  status public.brief_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.briefs is 'Periodic news summary container.';

-- Stories (ordered blocks within a brief)
create table public.stories (
  id uuid primary key default gen_random_uuid (),
  brief_id uuid not null references public.briefs (id) on delete cascade,
  position integer not null,
  markdown text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stories_brief_id_position_key unique (brief_id, position),
  constraint stories_position_positive check (position > 0)
);

comment on table public.stories is 'Single Markdown paragraph + ordering within a brief.';

create index stories_brief_id_idx on public.stories (brief_id);

-- Story ↔ article citations
create table public.story_articles (
  story_id uuid not null references public.stories (id) on delete cascade,
  article_id uuid not null references public.articles (id) on delete cascade,
  note text,
  primary key (story_id, article_id)
);

comment on table public.story_articles is 'Links a story to source articles (URLs via articles.canonical_url).';

-- updated_at trigger
create or replace function public.set_updated_at ()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger publishers_set_updated_at
before update on public.publishers
for each row
execute function public.set_updated_at ();

create trigger briefs_set_updated_at
before update on public.briefs
for each row
execute function public.set_updated_at ();

create trigger stories_set_updated_at
before update on public.stories
for each row
execute function public.set_updated_at ();
