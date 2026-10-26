# G3ID (sign-in) — worker and app

Sign-in for every team. Pages in `apps/g3id`, worker in `workers/g3id`. Members, kiosks, appearance and sign-in settings are edited on Portal's admin pages (`workers/portal/AGENTS.md`).

## Worker

- RESTful routes at `/auth/*` for login flows
- Slack integration at `/slack/*` for commands and events
- PIN authentication at `/auth/pin` for kiosk devices
- Admin routes at `/admin/*` (user management, kiosk device management)
- Database schema in `src/db/schema.ts` with migrations in `src/db/migrations/`
- Session management: OAuth sessions stored in KV with D1 backup, PIN sessions in D1 only
- **Important**: PIN sessions cannot access admin routes (enforced in `middleware/auth.ts`)
- **Last online:** `/auth/me`, which every app asks on each call, sets `core_users.last_seen_at` (migration `0022`; at most once a minute, in `waitUntil`). Portal's Members list and member page show it (`lastOnline`, `isOnline`: in the last 5 minutes, in `members-shared.tsx`), and the console's Stats counts from it.
- Deleting a user (`DELETE /admin/users/:id`) removes the account and everything that points at it (sign-ins, sessions, kiosk PIN, sign-in and activation codes, old merged-in shells) in one batch, so it's all or nothing; the team's kiosks pass to the admin doing it, and its Slack connection stays. A new table that points at `core_users` must be handled there. An admin can't delete their own account

## App

- Plugin-based architecture: each feature is a plugin with routes and nav items
- **ID only signs people in** (decided 15 October): its pages are sign-in (providers, email, the Slack code), sign-up and pending approval, `/demo`, and kiosk activation, PIN sign-in and removal. The account page and the admin pages for members and kiosks are on Portal (below); ID's old addresses redirect there (`Moved` in `shared/moved.tsx`: `/` and `/dashboard`, `/admin/users`, `/admin/users/:id`, `/admin/kiosk`). After a sign-in with nowhere else to go, the worker sends people to Portal's home; after linking a sign-in, to Portal's `/account`. ID isn't a tile on Portal or in the All Apps menu.

## Sign-in per team

each team signs in on its own G3ID, `<number>-id.<platform>` (G3: `1648-id.frcgearbox.com`). G3ID reads the team from the gateway's `X-Team-Id` (`requestTeamId()`, `workers/g3id/src/lib/team.ts`; the site's team without it) and sends members back to `teamFrontend()`. Google, GitHub and Steam all call back on the platform host `id.<platform>` (`signInCallbackApiUrl`; the gateway gives it no team), with the team, return address and any account being linked in the sign-in's state (`lib/oauth-state.ts`). Every sign-in method (providers, Slack codes, email, kiosk PIN) only signs in that team's members, and `sanitizeRedirect(url, team)` only allows that team's pages. Cross-team links in Slack DMs use `teamAppUrl(team, "id")`.

## Sign-in methods

- `lib/sign-in-methods.ts` (migration `0016`, `team_sign_in_methods`; no row = all on): admins switch Google, GitHub, Steam and kiosk PINs off for their team on the Sign-in page (`/admin/team/sign-in`; refused if it would leave the admin with no way in). The team's chat (Slack, or Discord for a team that connected it) is always on: members join through it. An off method can't start or finish a sign-in or a link (`methodOff` in each provider's routes and `/auth/pin`); with kiosk PINs off, no kiosk can be added (`/admin/kiosk/codes`, `/kiosk/activate`) and Portal's Kiosk Devices page only points to the Sign-in page; public `GET /team/sign-in` tells the sign-in and account pages which to show. Sessions already open stay. Portal shows only the apps that are on.

## Database

- `teams` — each team, keyed by `frc<number>` (`teamKey`); a request's team is `requestTeamId()` (`src/lib/team.ts`)
- `core_users` — user accounts with status (pending/active/rejected); **each belongs to exactly one team** (`team_id`, no memberships table; roles stay as `is_admin`/`is_mentor`); `display_name` (full name, admins edit it) and `username` (the chat account's name, locked), `needs_name` while someone new hasn't entered their name
- `core_user_identities` — linked auth providers per user
- `core_sessions` — active sessions (deprecated in favor of KV)
- `core_user_pins` — 3-digit PINs for kiosk login, unique within a team; a kiosk signs in only its own team's members
- `kiosk_devices` — registered shop devices with tokens, in the activating admin's team
- `kiosk_activation_codes` — 6-digit codes for device activation (30-min expiry)
- `core_slack_link_codes` — Slack sign-in and link codes with polling status: 4 digits, unique within a team (migration 0015); `insertCode` in `lib/slack-code.ts` deletes codes a day after they expire and draws again if a code is taken

Migrations are SQL files in `workers/g3id/src/db/migrations/` — always add new migrations for schema changes.

## Slack

Three flows:
1. **Sign-in**: User runs `/signin 123456` with a code from the web app
2. **Link**: Authenticated user runs `/link 123456` to add Slack to their account
3. **Events**: Slack bot receives 4-digit codes via DM and processes them

Routes:
- `POST /slack/events` — Slack event API (URL verification, DM messages)
- `POST /slack/commands/signin` — `/signin` slash command
- `POST /slack/commands/link` — `/link` slash command
- `GET /auth/slack/initiate` — Start sign-in flow
- `GET /auth/slack/link` — Start linking flow
- `GET /auth/slack/status` — Poll for completion (frontend calls every 2s)

Rate limiting: 5 attempts per 15 minutes per Slack user (via KV).

**New members waiting for approval:** a Slack or Discord sign-up that isn't a team's first member makes a pending account with `needs_name` set, named after the chat account (`displayName` and `username` both). Their sign-in page then sends them to ID's `/signup/name?token=` (`apps/g3id/src/plugins/auth/name-page.tsx`): the Slack page gets the token from `/auth/slack/status`, Discord's callback redirects there. It asks for their full name, filled in with the chat name (`GET`/`POST /auth/signup/name`, `routes/auth/signup-name.ts`; `lib/signup-name.ts`: a one-time KV token, good for a day). Only once it's saved does every active admin of the team with its chat linked get a DM with the person's name, email, chat name and a link to their page on Portal's Members list (`saveSignupName` → `dmAdmins` in `lib/member-dm.ts`). Someone who left before entering it gets the step again when they next sign in. It never fails the sign-up. Slack and Discord sign-ups are the only ways to make a pending account; a team's founder keeps their chat name.

**Names and usernames** (migration `0020`): `core_users.display_name` is the member's full name, which they enter when they join and admins change on their page in Portal's Members list (`PUT /admin/users/:id/name`, in `DEMO_BLOCKED`); `username` is the name on the chat account they joined with, set at sign-up and never edited (accounts from before 0020 got their name then). Members shows the username beside the name when they differ, and searches it.

**Choosing a channel:** every page that asks for a channel uses `ChannelPicker` from `@g3/ui` (plain CSS, `channel-picker.css`): admins search the team's channels by name on its chat (G3ID's `GET /admin/chat/channels`: Slack's from `listChannels` in `@g3/slack`, which needs the bot's `channels:read` and `groups:read`; Discord's from `listChannels` in `@g3/discord`, with whether the bot can post worked out from its roles and the channel's overwrites), it saves the channel's ID and warns when the bot can't post there. Without a chat, or on a Slack connection from before those scopes (409 `reconnect`), it links to Integrations and takes a typed ID. Used by Shop's channel settings and Portal's Notifications page. Pages name the team's chat with `useTeamChat()` / `chatName()` from `@g3/ui` (G3ID's public `GET /team/chat`).

**Slack per team:** one Slack app, installed into each team's workspace by a team admin (the Slack card on the Integrations page of the team's admin pages, Portal's `/admin/integrations`: G3ID's `GET /slack/install` through `/api/~id`; Slack calls back on `id.<platform>/api/slack/oauth/callback`, which sends the admin back to the home's `/admin/integrations`; the old `/admin/slack` redirects there). `slack_installations` holds each team's workspace ID and bot token, encrypted with the `SECRETS_KEY` secret (`encryptSecret` in `@g3/auth`). `lib/slack-install.ts`: `slackForTeam(env, team)` gives the workspace and a `{ SLACK_BOT_TOKEN }` for `@g3/slack`; `teamForWorkspace(env, workspaceId)` routes slash commands and events. A sign-in code only works from its own team's workspace. The site's team falls back to the `SLACK_BOT_TOKEN` / `SLACK_TEAM_ID` settings until it connects. Every app sends its messages through G3ID (`sendMemberDM`, `sendTeamMessage`, `/chat/*`), which sends them on Slack or Discord; no app holds a chat token.

## Discord

**Discord** (`docs/roadmap/discord.md`, set up in `docs/deploy.md`, "Discord"): a team uses Slack or Discord, one at a time (`saveInstallation` and `saveDiscordInstallation` refuse the second). One Discord app with one bot token (`DISCORD_BOT_TOKEN`, with `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET`; required: Discord is always offered) serves every team, so `discord_installations` (G3ID migration `0019`) holds only each team's server id (`lib/discord-install.ts`). Everything is plain HTTPS (`@g3/discord`): no Gateway connection, so the bot never reads messages. Admins connect a server on Integrations (`GET /auth/discord/install`, which also links their Discord); members sign in, sign up and link with Discord's OAuth (`routes/auth/discord.ts`, one callback, `/auth/discord/callback` on `id.<platform>`, `DISCORD_REDIRECT_URI` for the site team in dev): someone new is signed up only if the bot finds them in the team's server and Discord has verified their email (`lib/discord-sign-in.ts`). `lib/chat.ts` is the one place that sends: `chatForTeam` (Discord first, else Slack), `sendChatDM`, `postToChannel`, `listChatChannels`; a Discord send that fails because the bot left the server forgets the team's server. Messages are written in **Gearbox's chat format**, Discord's Markdown that both can show (`**bold**`, `[label](https://...)`, `> ` quotes, `<t:UNIX:f>` times, Unicode emoji, never `:names:`); Discord takes it as it is (in 2,000-character pieces, `splitMessage`) and Slack gets `toSlack` from `@g3/slack`. The fake `discord.com` for worker tests is `@g3/testing/discord` (ids say who's in which server).

## Kiosks

PIN-based access for untrusted computers:
- 3-digit numeric PIN assigned per user
- Device activation via 6-digit code (admin-generated, 30-min expiry)
- Kiosk token stored in browser localStorage, validated on every request
- Sessions marked as `sessionType: 'pin'` to prevent admin access
- If token is invalid/revoked, app redirects to `/kiosk/activate`

## Testing by hand

**Test Slack locally:**
- Sign-in codes generated and stored in D1
- Frontend polls `/auth/slack/status` every 2s
- Status persists in D1 (immediate, not KV eventual consistency)

**Test kiosk flow:**
- Admin generates 6-digit activation code
- Device enters code at `/kiosk/activate`
- Receives kiosk token, stores in localStorage
- PIN login at `/kiosk/login` requires valid token in header

## Common tasks

**Add a new auth provider:**
1. Create route handler in `workers/g3id/src/routes/auth/<provider>.ts`
2. Export router and mount at `workers/g3id/src/index.ts` (line with `.route("/auth", ...)`)
3. Add login page/button to `apps/g3id/src/plugins/auth/`
4. Update NavBar filtering if needed

**Add admin feature:**
1. Add route to `workers/g3id/src/routes/admin.ts` (uses `requireAdmin` middleware)
2. **Remember**: PIN sessions will get 403 "Admin access not allowed from kiosk"
3. Protect via admin-only NavBar visibility

**Database schema change:**
1. Create migration file: `workers/g3id/src/db/migrations/000X_description.sql`
2. Update `workers/g3id/src/db/schema.ts` Drizzle definitions
3. Test locally: `wrangler d1 migrations apply <database-name> --local`

**Create dev accounts with email/password (as admin):**
```
GET http://localhost:8787/auth/dev/create-user?email=test@example.com&password=password123&name=TestUser
```
- Requires admin authentication (logged in as admin)
- Development environment only
- Query params: `email` (required), `password` (required, 8+ chars), `name` (optional, defaults to email prefix)
- Creates an active user immediately (no approval needed)
- New user can log into any app with their email/password

## Key files

- `src/middleware/auth.ts` — requireAuth, requireAdmin, requireKioskToken
- `src/routes/auth/slack.ts` — Slack OAuth flow; `src/routes/slack.ts` — slash commands and events; `src/lib/slack-code.ts` — Slack sign-in codes
- `src/lib/chat.ts` — sending on a team's chat, Slack or Discord; `src/routes/auth/discord.ts` — Discord sign-in, linking and connecting a server
