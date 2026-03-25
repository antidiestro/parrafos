-- Run story clusters are ingestion artifacts; authenticated users can read.

alter table public.run_story_clusters enable row level security;
alter table public.run_story_cluster_sources enable row level security;

create policy "Authenticated users can read run_story_clusters"
on public.run_story_clusters
for select
to authenticated
using (true);

create policy "Authenticated users can read run_story_cluster_sources"
on public.run_story_cluster_sources
for select
to authenticated
using (true);
