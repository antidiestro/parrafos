-- Row Level Security: anon reads published editorial content; authenticated users manage briefs/stories.
-- Ingestion tables (publishers read-only to clients; writes via service_role only).

alter table public.publishers enable row level security;

alter table public.runs enable row level security;

alter table public.articles enable row level security;

alter table public.briefs enable row level security;

alter table public.stories enable row level security;

alter table public.story_articles enable row level security;

-- Publishers: public catalog read
create policy "Anyone can read publishers"
on public.publishers
for select
to anon, authenticated
using (true);

-- Runs: no policies for anon/authenticated (deny); service_role bypasses RLS

-- Articles: no policies for anon/authenticated (deny); service_role bypasses RLS

-- Briefs
create policy "Anon can read published briefs"
on public.briefs
for select
to anon
using (status = 'published');

create policy "Authenticated users manage briefs"
on public.briefs
for all
to authenticated
using (true)
with check (true);

-- Stories
create policy "Anon can read stories for published briefs"
on public.stories
for select
to anon
using (
  exists (
    select 1
    from public.briefs b
    where b.id = stories.brief_id
      and b.status = 'published'
  )
);

create policy "Authenticated users manage stories"
on public.stories
for all
to authenticated
using (true)
with check (true);

-- story_articles
create policy "Anon can read story_articles for published briefs"
on public.story_articles
for select
to anon
using (
  exists (
    select 1
    from public.stories s
    join public.briefs b on b.id = s.brief_id
    where s.id = story_articles.story_id
      and b.status = 'published'
  )
);

create policy "Authenticated users manage story_articles"
on public.story_articles
for all
to authenticated
using (true)
with check (true);
