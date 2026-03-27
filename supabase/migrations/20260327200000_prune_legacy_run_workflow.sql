-- Remove admin/worker-era normalized run state, cluster checkpoints, and unused runs columns.
-- Narrow run_status to values the workflow console uses.

-- Normalized workflow tables (from 20260326150000_normalize_run_workflow_state.sql)
drop policy if exists "Authenticated users can read run stage executions"
  on public.run_stage_executions;
drop policy if exists "Authenticated users can read run publishers progress"
  on public.run_publishers_progress;
drop policy if exists "Authenticated users can read run articles progress"
  on public.run_articles_progress;
drop policy if exists "Authenticated users can read run errors" on public.run_errors;
drop policy if exists "Authenticated users can read run events" on public.run_events;

drop table if exists public.run_stage_executions;
drop table if exists public.run_publishers_progress;
drop table if exists public.run_articles_progress;
drop table if exists public.run_errors;
drop table if exists public.run_events;

-- Story cluster checkpoints (run_story_summaries references run_story_clusters)
drop policy if exists "Authenticated users can read run_story_summaries"
  on public.run_story_summaries;
drop table if exists public.run_story_summaries;

drop policy if exists "Authenticated users can read run_story_cluster_sources"
  on public.run_story_cluster_sources;
drop policy if exists "Authenticated users can read run_story_clusters"
  on public.run_story_clusters;

drop table if exists public.run_story_cluster_sources;
drop table if exists public.run_story_clusters;

-- Worker observability index + columns on runs
drop index if exists public.runs_current_stage_idx;

alter table public.runs drop column if exists publisher_count;
alter table public.runs drop column if exists publishers_done;
alter table public.runs drop column if exists articles_found;
alter table public.runs drop column if exists articles_upserted;
alter table public.runs drop column if exists clusters_total;
alter table public.runs drop column if exists clusters_eligible;
alter table public.runs drop column if exists clusters_selected;
alter table public.runs drop column if exists sources_selected;
alter table public.runs drop column if exists current_stage;
alter table public.runs drop column if exists stage_attempt;
alter table public.runs drop column if exists last_heartbeat_at;

drop type if exists public.run_stage_status;
drop type if exists public.run_stage;

-- Narrow run_status: map legacy values, swap enum
update public.runs
set status = 'failed'::public.run_status
where status in ('pending'::public.run_status, 'cancelled'::public.run_status);

alter type public.run_status rename to run_status_old;

create type public.run_status as enum ('running', 'completed', 'failed');

alter table public.runs alter column status drop default;

alter table public.runs
  alter column status type public.run_status
  using (
    case status::text
      when 'running' then 'running'::public.run_status
      when 'completed' then 'completed'::public.run_status
      when 'failed' then 'failed'::public.run_status
      else 'failed'::public.run_status
    end
  );

alter table public.runs alter column status set default 'running'::public.run_status;

drop type public.run_status_old;
