-- Persist run-scoped story clustering and source assignments.

create table public.run_story_clusters (
  id uuid primary key default gen_random_uuid (),
  run_id uuid not null references public.runs (id) on delete cascade,
  title text not null,
  summary text,
  selection_reason text,
  source_count integer not null default 0,
  status text not null default 'clustered' check (
    status in (
      'clustered',
      'eligible',
      'selected',
      'discarded_low_sources',
      'not_selected'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.run_story_clusters is 'Run-scoped story clusters created from identified sources.';

create index run_story_clusters_run_id_idx on public.run_story_clusters (run_id);
create index run_story_clusters_run_id_status_idx on public.run_story_clusters (run_id, status);

create trigger run_story_clusters_set_updated_at
before update on public.run_story_clusters
for each row
execute function public.set_updated_at ();

create table public.run_story_cluster_sources (
  cluster_id uuid not null references public.run_story_clusters (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  publisher_id uuid not null references public.publishers (id) on delete restrict,
  url text not null,
  canonical_url text not null,
  title text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (cluster_id, canonical_url),
  constraint run_story_cluster_sources_run_unique unique (
    run_id,
    publisher_id,
    canonical_url
  )
);

comment on table public.run_story_cluster_sources is 'Source assignments for run story clusters; one source can belong to only one cluster per run.';

create index run_story_cluster_sources_run_id_idx on public.run_story_cluster_sources (run_id);
create index run_story_cluster_sources_cluster_id_idx on public.run_story_cluster_sources (cluster_id);
