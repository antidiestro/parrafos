-- Persist publish-stage story summary checkpoints in first-class rows.

create table public.run_story_summaries (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs (id) on delete cascade,
  cluster_id uuid not null references public.run_story_clusters (id) on delete cascade,
  title text not null,
  detail_markdown text not null,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint run_story_summaries_run_cluster_key unique (run_id, cluster_id)
);

comment on table public.run_story_summaries is 'Latest publish-stage story summary checkpoint per run cluster.';

create index run_story_summaries_run_id_position_idx
on public.run_story_summaries (run_id, position);

create index run_story_summaries_cluster_id_idx
on public.run_story_summaries (cluster_id);

create trigger run_story_summaries_set_updated_at
before update on public.run_story_summaries
for each row
execute function public.set_updated_at ();

alter table public.run_story_summaries enable row level security;

create policy "Authenticated users can read run_story_summaries"
on public.run_story_summaries
for select
to authenticated
using (true);
