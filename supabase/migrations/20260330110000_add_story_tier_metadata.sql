-- Extend stories so primary and secondary selected clusters can live together.

alter table public.stories
  add column if not exists tier text not null default 'primary',
  add column if not exists cluster_id text,
  add column if not exists selection_reason text,
  add column if not exists source_count integer;

alter table public.stories
  drop constraint if exists stories_tier_check;

alter table public.stories
  add constraint stories_tier_check
  check (tier in ('primary', 'secondary'));

alter table public.stories
  drop constraint if exists stories_source_count_nonnegative;

alter table public.stories
  add constraint stories_source_count_nonnegative
  check (source_count is null or source_count >= 0);

create index if not exists stories_brief_id_tier_position_idx
  on public.stories (brief_id, tier, position);

comment on column public.stories.tier is
  'Selection tier for a published story row: primary appears in brief_sections; secondary appears in the homepage secondary list.';

comment on column public.stories.cluster_id is
  'Pipeline cluster identifier used to trace persisted story rows back to selected clusters.';
