# AGENTS Guide (Repo Root)

## Scope
- Applies to the entire repository unless a deeper `AGENTS.md` overrides local details.

## Start Here
- Project onboarding and operations: `README.md`
- Source tree routing: `src/AGENTS.md`
- Database and migrations routing: `supabase/AGENTS.md`

## How to Navigate This Repo
- App routes and handlers: `src/app/`
- Shared domain logic: `src/lib/`
- Worker/ops entrypoints: `src/scripts/`
- Database schema and RLS: `supabase/`

## Required Workflow for Agents
- Read the nearest `AGENTS.md` before editing files in that subtree.
- Read co-located `README.md` files for affected domains before implementing changes.
- Keep changes scoped and update the docs nearest to the changed code.

## Mandatory Documentation Update Policy
- If you change behavior, contracts, architecture, workflows, or invariants in any subtree, you must update that subtree's co-located `README.md` in the same change.
- If there is a deeper scope `AGENTS.md`, follow its additional documentation requirements too.

## Validation Baseline
- `npm run lint`
- `npx tsc --noEmit`
- Run targeted runtime checks relevant to modified domain (web route, admin flow, worker, or DB workflow).
