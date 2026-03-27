-- Rename editorial table brief_paragraphs → brief_sections (one markdown section per story per brief).

drop policy if exists "Anon can read brief_paragraphs for published briefs"
  on public.brief_paragraphs;

drop policy if exists "Authenticated users manage brief_paragraphs"
  on public.brief_paragraphs;

alter table public.brief_paragraphs rename to brief_sections;

alter table public.brief_sections rename constraint brief_paragraphs_pkey to brief_sections_pkey;

alter table public.brief_sections rename constraint brief_paragraphs_brief_id_fkey to brief_sections_brief_id_fkey;

alter table public.brief_sections rename constraint brief_paragraphs_story_id_fkey to brief_sections_story_id_fkey;

alter table public.brief_sections rename constraint brief_paragraphs_brief_id_position_key to brief_sections_brief_id_position_key;

alter table public.brief_sections rename constraint brief_paragraphs_brief_id_story_id_key to brief_sections_brief_id_story_id_key;

alter table public.brief_sections rename constraint brief_paragraphs_position_positive to brief_sections_position_positive;

alter index public.brief_paragraphs_brief_id_idx rename to brief_sections_brief_id_idx;

alter index public.brief_paragraphs_story_id_idx rename to brief_sections_story_id_idx;

alter trigger brief_paragraphs_set_updated_at on public.brief_sections rename to brief_sections_set_updated_at;

comment on table public.brief_sections is
  'Ordered brief sections (final markdown per story) linked one-to-one with stories within a brief.';

alter table public.brief_sections enable row level security;

create policy "Anon can read brief_sections for published briefs"
on public.brief_sections
for select
to anon
using (
  exists (
    select 1
    from public.briefs b
    where b.id = brief_sections.brief_id
      and b.status = 'published'
  )
);

create policy "Authenticated users manage brief_sections"
on public.brief_sections
for all
to authenticated
using (true)
with check (true);
