-- Row Level Security for brief_paragraphs follows stories visibility:
-- anon can read paragraphs for published briefs; authenticated users manage.

alter table public.brief_paragraphs enable row level security;

create policy "Anon can read brief_paragraphs for published briefs"
on public.brief_paragraphs
for select
to anon
using (
  exists (
    select 1
    from public.briefs b
    where b.id = brief_paragraphs.brief_id
      and b.status = 'published'
  )
);

create policy "Authenticated users manage brief_paragraphs"
on public.brief_paragraphs
for all
to authenticated
using (true)
with check (true);
