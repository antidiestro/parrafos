# AGENTS Guide (`src/lib/`)

## Scope
- Applies to `src/lib/**` unless a deeper scope guide is added later.

## Read These First
- `src/lib/README.md`
- Domain docs as needed:
  - `src/lib/runs/README.md`
  - `src/lib/extract/README.md`
  - `src/lib/data/README.md`
  - `src/lib/supabase/README.md`
  - `src/lib/gemini/README.md`

## Where to Implement Changes
- Data reads: `src/lib/data/*`
- Extraction orchestration: `src/lib/runs/*`
- Fetch/sanitization mechanics: `src/lib/extract/*`
- External integrations/env wrappers: `src/lib/supabase/*`, `src/lib/gemini/*`

## Guardrails
- Maintain typed contracts and explicit error handling.
- Preserve server-only constraints for service-role and API key usage.
- Keep orchestration (`runs`) separated from low-level fetch/transform logic.

## Mandatory Documentation Update Policy
- Any `src/lib/**` change that affects behavior, contracts, invariants, env requirements, or operational assumptions must include updates to the corresponding co-located `README.md` files in the same change.

## Validation
- `npm run lint`
- `npx tsc --noEmit`
- Run targeted execution path (homepage/workflow console) based on modified module.
