# Adding an OAuth Provider to G3ID

This document outlines every change needed to wire up a new OAuth provider (sign-in, sign-up, and account linking from the dashboard).

---

## 1. Register the OAuth App with the Provider

Create an OAuth application in the provider's developer console. You will need:

- **Client ID** and **Client Secret**
- **Redirect URIs** — every one of them, so the same app works in dev and for every team:
  - Dev: `http://localhost:5173/api/auth/{provider}/callback` (through the Vite proxy)
  - The site's team: `https://id.<domain>/api/auth/{provider}/callback`
  - Every other team: `https://id.<platform domain>/api/auth/{provider}/callback`

  Sign-in calls back on the `id.` host of the team's own domain, so the session cookie lands there (`providerRedirectUri()` in `src/lib/team.ts`).

Request the minimum scopes needed. At minimum you need the user's unique ID (sub/uid), email address, and display name.

---

## 2. Environment Variables

**`workers/g3id/.dev.vars.example`** — add three entries:
```
{PROVIDER}_CLIENT_ID=
{PROVIDER}_CLIENT_SECRET=
{PROVIDER}_REDIRECT_URI=http://localhost:5173/api/auth/{provider}/callback
```

**`workers/g3id/.dev.vars`** — fill in your actual credentials (gitignored, never commit).

**Production secrets** — set via Wrangler rather than a committed file:
```
wrangler secret put {PROVIDER}_CLIENT_ID --env production
wrangler secret put {PROVIDER}_CLIENT_SECRET --env production
```

**`workers/g3id/wrangler.toml`** — add `{PROVIDER}_REDIRECT_URI` to `[env.production.vars]`, add the provider to the `(GOOGLE|GITHUB|STEAM|ONSHAPE)` list in `scripts/configure.ts`, and run `pnpm configure`, which writes the site team's callback address. Other teams' addresses come from `providerRedirectUri()`; add the provider to it too.

**`workers/g3id/src/types.ts`** — add the three variables to the `Bindings` block of `AppEnv`.

---

## 3. Update the Database Schema

**`workers/g3id/src/db/schema.ts`** — the `core_user_identities` table has a `CHECK` constraint listing allowed provider values. Add the new provider name to that list.

**`workers/g3id/src/db/migrations/`** — write a new migration SQL file that `ALTER`s the table or recreates the check constraint to include the new provider. Run it locally with `wrangler d1 migrations apply --local`.

---

## 4. Create the Route File

Create `workers/g3id/src/routes/auth/{provider}.ts` and export a Hono router. The file needs three endpoints:

### `GET /auth/{provider}`
- Initiation endpoint for unauthenticated users (sign-in / sign-up).
- Generate a 16-byte random hex state value.
- Store it in the `RATE_LIMIT` KV namespace under `oauth_state:{state}` with a 10-minute TTL. The value should be the string `"signin"`.
- Build the provider's authorization URL with the required query parameters (client ID, redirect URI, scopes, state, etc.) and redirect to it.

### `GET /auth/{provider}/link`
- Initiation endpoint for already-authenticated users (adding the provider to an existing account).
- Resolve the request's cookie header to a user ID via `resolveUserId` from `@g3/auth`. If there is no valid session, redirect to `/login`.
- Generate state the same way as above, but store `"link:{userId}"` as the KV value instead of `"signin"`.
- Redirect to the same authorization URL.

### `GET /auth/{provider}/callback`
- Shared callback for both flows.
- Read `code`, `state`, and any `error` query parameters.
- If `error` is present, redirect to `/login/error?error=...`.
- Look up the state value in KV, delete it immediately (prevents replay), and reject with a redirect to the error page if it is missing or expired.
- Exchange the `code` for tokens by POSTing to the provider's token endpoint with the code, client ID, client secret, redirect URI, and grant type.
- Extract the user's unique identifier (sub/uid), email, and display name from the token response. Many providers return an ID token JWT (decode the middle base64url segment to get the payload). Others return a separate userinfo endpoint you must call.

**Branch on the state value:**

- **Link flow** (`"link:{userId}"`):
  - Load the user and verify they are active.
  - Check whether the provider identity (matching provider + provider_id) already exists. If it belongs to this user, redirect to `/dashboard` (already linked, no-op). If it belongs to a different user, redirect to the error page.
  - Insert the new identity row and redirect to `/dashboard`.

- **Sign-in flow** (`"signin"`):
  - Look up `core_user_identities` by provider + provider_id.
  - **Returning user**: verify the user is active, create a session, set the `g3_session` cookie (HttpOnly, Secure, SameSite=Lax, 7-day maxAge), redirect to `/dashboard`.
  - **No identity found, email exists**: redirect to the error page with a message telling the user to sign in with their existing method and add the new provider from account settings. Do not auto-link — this prevents account hijacking via email collision.
  - **Completely new user**: insert a pending `core_users` row and a `core_user_identities` row in a single `db.batch()` call, redirect to `/pending`.

---

## 5. Register the Routes

**`workers/g3id/src/index.ts`** — import the new router and mount it at `/auth`:
```
app.route("/auth", {provider}AuthRouter);
```

---

## 6. Wire Up the Frontend Buttons

On the login page (`apps/g3id/src/plugins/auth/login-page.tsx`) and signup page (`apps/g3id/src/plugins/auth/signup-page.tsx`), change the provider's placeholder `<button>` to an `<a>` tag pointing to `/api/auth/{provider}`. Use a plain `<a>` (not React Router's `<Link>`) so the browser performs a real navigation to the backend endpoint.

On the dashboard (`apps/g3id/src/plugins/auth/dashboard-page.tsx`):
- Add the new provider to the `PROVIDER_LABELS` map.
- Add a "Connect {Provider}" button (styled as an `<a href="/api/auth/{provider}/link">`) that is only rendered when the provider is not already in `me.identities`.

In the admin users page (`apps/g3id/src/plugins/admin/admin-users-page.tsx`), add the new provider to the `PROVIDER_LABELS` map so it displays correctly in the identity badges.

---

## 7. Session Cookie

The callback sets one cookie: `g3_session`. Use the same options as the Google implementation — HttpOnly, Secure, SameSite=Lax, path `/`, 7-day maxAge. Do not introduce a second cookie.

---

## Summary Checklist

- [ ] OAuth app registered with provider; redirect URI set to `/api/auth/{provider}/callback` on both dev and prod origins
- [ ] Three env vars added to `.dev.vars.example`, `.dev.vars`, and `AppEnv` bindings
- [ ] Provider name added to the `CHECK` constraint in the schema and a migration written
- [ ] `src/routes/auth/{provider}.ts` created with initiation, link, and callback endpoints
- [ ] Router mounted in `src/index.ts`
- [ ] Login and signup page buttons converted to `<a>` links pointing to `/api/auth/{provider}`
- [ ] Dashboard "Connect" button added, gated on the provider not already being in `me.identities`
- [ ] `PROVIDER_LABELS` updated in both the dashboard and admin users page
