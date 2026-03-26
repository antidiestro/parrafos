-- Normalize run workflow state and critical article/run metadata.

create type public.run_stage as enum (
  'discover_candidates',
  'prefetch_metadata',
  'cluster_sources',
  'select_clusters',
  'extract_bodies',
  'upsert_articles',
  'publish_brief'
);

create type public.run_stage_status as enum (
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled'
);

alter table public.runs
  add column if not exists extract_model text,
  add column if not exists cluster_model text,
  add column if not exists relevance_model text,
  add column if not exists publisher_count integer not null default 0,
  add column if not exists publishers_done integer not null default 0,
  add column if not exists articles_found integer not null default 0,
  add column if not exists articles_upserted integer not null default 0,
  add column if not exists clusters_total integer not null default 0,
  add column if not exists clusters_eligible integer not null default 0,
  add column if not exists clusters_selected integer not null default 0,
  add column if not exists sources_selected integer not null default 0,
  add column if not exists current_stage public.run_stage,
  add column if not exists stage_attempt integer not null default 0,
  add column if not exists last_heartbeat_at timestamptz;

create index if not exists runs_current_stage_idx
  on public.runs (current_stage, status);

create table public.run_stage_executions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  stage public.run_stage not null,
  attempt integer not null default 1 check (attempt > 0),
  status public.run_stage_status not null default 'pending',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  heartbeat_at timestamptz not null default now(),
  resume_cursor jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint run_stage_executions_run_stage_attempt_key unique (run_id, stage, attempt)
);

create index run_stage_executions_run_id_idx
  on public.run_stage_executions (run_id, created_at desc);

create index run_stage_executions_run_id_status_idx
  on public.run_stage_executions (run_id, status, stage);

create trigger run_stage_executions_set_updated_at
before update on public.run_stage_executions
for each row
execute function public.set_updated_at ();

create table public.run_publishers_progress (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  publisher_id uuid not null references public.publishers (id) on delete restrict,
  publisher_name text not null,
  base_url text not null,
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed')
  ),
  articles_found integer not null default 0,
  articles_upserted integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint run_publishers_progress_run_publisher_key unique (run_id, publisher_id)
);

create index run_publishers_progress_run_id_idx
  on public.run_publishers_progress (run_id, status);

create trigger run_publishers_progress_set_updated_at
before update on public.run_publishers_progress
for each row
execute function public.set_updated_at ();

create table public.run_articles_progress (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  publisher_id uuid not null references public.publishers (id) on delete restrict,
  url text not null,
  canonical_url text,
  title text,
  published_at timestamptz,
  status text not null check (
    status in (
      'pending',
      'identified',
      'metadata_fetching',
      'metadata_ready',
      'approving',
      'approved',
      'rejected',
      'clustering',
      'clustered',
      'selected_for_extraction',
      'not_selected_for_extraction',
      'skipped_existing',
      'fetching',
      'extracted',
      'upserted',
      'failed'
    )
  ),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint run_articles_progress_run_pub_url_key unique (run_id, publisher_id, url)
);

create index run_articles_progress_run_id_idx
  on public.run_articles_progress (run_id, status);

create index run_articles_progress_run_pub_canonical_idx
  on public.run_articles_progress (run_id, publisher_id, canonical_url);

create trigger run_articles_progress_set_updated_at
before update on public.run_articles_progress
for each row
execute function public.set_updated_at ();

create table public.run_errors (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  stage public.run_stage,
  publisher_id uuid references public.publishers (id) on delete set null,
  url text,
  message text not null,
  created_at timestamptz not null default now()
);

create index run_errors_run_id_idx
  on public.run_errors (run_id, created_at desc);

create table public.run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  stage public.run_stage,
  event_type text not null,
  message text,
  context jsonb,
  created_at timestamptz not null default now()
);

create index run_events_run_id_idx
  on public.run_events (run_id, created_at desc);

alter table public.articles
  add column if not exists source_url text,
  add column if not exists extraction_model text,
  add column if not exists clustering_model text,
  add column if not exists relevance_selection_model text;

alter table public.run_stage_executions enable row level security;
alter table public.run_publishers_progress enable row level security;
alter table public.run_articles_progress enable row level security;
alter table public.run_errors enable row level security;
alter table public.run_events enable row level security;

create policy "Authenticated users can read run stage executions"
on public.run_stage_executions
for select
to authenticated
using (true);

create policy "Authenticated users can read run publishers progress"
on public.run_publishers_progress
for select
to authenticated
using (true);

create policy "Authenticated users can read run articles progress"
on public.run_articles_progress
for select
to authenticated
using (true);

create policy "Authenticated users can read run errors"
on public.run_errors
for select
to authenticated
using (true);

create policy "Authenticated users can read run events"
on public.run_events
for select
to authenticated
using (true);
