# @g3/auth

Sign-in for G3 workers.

**Every worker except G3ID** (`src/g3id.ts`): middleware that asks G3ID, through the worker's `G3ID` service binding, who the request's session cookie belongs to, and sets the user on the context (`c.get("userId")`, `userIsAdmin`, `userIsMentor`, `sessionType`, ...). Give the worker's `AppEnv` `Variables: G3AuthVariables`.

- `requireAuth`: any signed-in user (401 otherwise).
- `requireAuthWithIdentities`: the same, plus linked accounts (`userSlackId`). Costs G3ID more, so only where needed.
- `requireAdmin`: G3ID admins.
- `requireMentor` / `hasMentorAccess(c)`: G3ID mentors or admins.
- `requireOAuthSession`: after `requireAuth`, refuses kiosk PIN sessions (for app-local roles G3ID doesn't know about).

G3ID never reports admin or mentor for a kiosk PIN session, so the role checks are already safe from kiosks.

**G3ID itself** (`src/index.ts`): `resolveUserId` reads the session straight from KV.
