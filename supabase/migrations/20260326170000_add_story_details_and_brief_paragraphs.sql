-- Store extended story summaries separately from final brief paragraphs.
alter table public.stories
add column detail_markdown text;

comment on column public.stories.detail_markdown is
  'Extended per-story markdown summary for modal display (Axios-like sections with citations).';

create table public.brief_paragraphs (
  id uuid primary key default gen_random_uuid (),
  brief_id uuid not null references public.briefs (id) on delete cascade,
  story_id uuid not null references public.stories (id) on delete cascade,
  position integer not null,
  markdown text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brief_paragraphs_brief_id_position_key unique (brief_id, position),
  constraint brief_paragraphs_brief_id_story_id_key unique (brief_id, story_id),
  constraint brief_paragraphs_position_positive check (position > 0)
);

comment on table public.brief_paragraphs is
  'Ordered final brief paragraphs linked to one story summary each.';

create index brief_paragraphs_brief_id_idx on public.brief_paragraphs (brief_id);
create index brief_paragraphs_story_id_idx on public.brief_paragraphs (story_id);

create trigger brief_paragraphs_set_updated_at
before update on public.brief_paragraphs
for each row
execute function public.set_updated_at ();
