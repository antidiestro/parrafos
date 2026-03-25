# `src/lib/auth`

## Purpose
- Admin authentication/session primitives for route protection and server actions.

## Key Files
- `admin-session.ts`: HMAC-signed session token create/verify.
- `require-admin.ts`: server-side guard that redirects to `/admin/login` on invalid/missing session.
- Related entrypoint: `src/middleware.ts` for edge-level `/admin` checks.

## Contracts and Invariants
- Session token format: `<expUnixSeconds>.<hmacHex>`.
- Signature uses `ADMIN_SESSION_SECRET`; missing secret denies access.
- Verification checks expiration and signature (timing-safe compare).

## Common Changes
- Session TTL format/logic changes: keep middleware + server guard behavior aligned.
- Cookie name changes: update everywhere (`ADMIN_SESSION_COOKIE` users).

## Verification
- Login flow sets cookie and grants `/admin` access.
- Invalid/expired cookie redirects to `/admin/login`.
- `npm run lint`

## Gotchas
- Middleware protection is necessary but not sufficient; server actions must still call `requireAdminSession()`.
- Treat `ADMIN_SESSION_SECRET` as sensitive server-only config.
