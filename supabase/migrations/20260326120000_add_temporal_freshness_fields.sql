alter table public.publishers
add column if not exists default_timezone text not null default 'America/Santiago';

alter table public.articles
add column if not exists published_at_raw text,
add column if not exists published_at_timezone text,
add column if not exists published_at_precision text,
add column if not exists published_at_source text,
add column if not exists published_at_confidence double precision;

alter table public.run_story_cluster_sources
add column if not exists published_at_raw text,
add column if not exists published_at_timezone text,
add column if not exists published_at_precision text,
add column if not exists published_at_source text,
add column if not exists published_at_confidence double precision;
