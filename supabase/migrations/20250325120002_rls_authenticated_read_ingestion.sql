-- Editors need read access to articles and runs when linking stories; writes stay service_role-only.

create policy "Authenticated users can read articles"
on public.articles
for select
to authenticated
using (true);

create policy "Authenticated users can read runs"
on public.runs
for select
to authenticated
using (true);
