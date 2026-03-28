-- Snapshot of canonical URLs discovered per console run (for churn / diff tooling).

create table public.run_discovery_candidates (
  run_id uuid not null references public.runs (id) on delete cascade,
  canonical_urls text[] not null,
  created_at timestamptz not null default now (),
  constraint run_discovery_candidates_run_id_key primary key (run_id)
);

comment on table public.run_discovery_candidates is
  'Deduplicated canonical article URLs from discover_candidates for each runs row; service_role writes.';

create index run_discovery_candidates_created_at_idx
  on public.run_discovery_candidates (created_at desc);

alter table public.run_discovery_candidates enable row level security;

-- Match ingestion read model: editors can observe snapshots; writes via service_role only.
create policy "Authenticated users can read run_discovery_candidates"
on public.run_discovery_candidates
for select
to authenticated
using (true);
