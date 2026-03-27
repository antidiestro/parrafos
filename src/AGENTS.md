# AGENTS Guide (`src/`)

## Scope
- Applies to `src/**` unless a deeper `AGENTS.md` exists.

## Read These First
- `src/app/README.md`
- `src/lib/README.md`
- `src/scripts/README.md`

## Routing
- Route/UI/API work: `src/app/AGENTS.md`
- Shared domain/integration work: `src/lib/AGENTS.md`
- Worker runtime notes: `src/scripts/README.md`

## Editing Guidance
- Keep route files thin and move business logic to `src/lib`.
- Reuse existing helpers in `src/lib/data`, `src/lib/auth`, `src/lib/runs`, and integration modules.
- Preserve server-only boundaries for privileged clients/keys.

## Mandatory Documentation Update Policy
- Any change to runtime behavior, data flow, module contracts, or operational workflow in `src/**` must include updates to the relevant co-located `README.md` files (and deeper-scope docs when applicable) in the same change.

## Validation
- `npm run lint`
- `npx tsc --noEmit`
- Run the relevant flow:
  - web: `npm run dev`
  - workflow console: `npm run workflow:console`
