alter table public.run_story_cluster_sources
drop column if exists published_at_raw,
drop column if exists published_at_timezone,
drop column if exists published_at_precision,
drop column if exists published_at_source,
drop column if exists published_at_confidence;

alter table public.articles
drop column if exists published_at_raw,
drop column if exists published_at_timezone,
drop column if exists published_at_precision,
drop column if exists published_at_source,
drop column if exists published_at_confidence;

alter table public.publishers
drop column if exists default_timezone;
