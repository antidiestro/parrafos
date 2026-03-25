alter table public.articles
add column if not exists published_at timestamptz;
