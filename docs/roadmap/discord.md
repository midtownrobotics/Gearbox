# Discord alongside Slack

Goal: a team that uses Discord instead of Slack can do everything a Slack team can. That means sign up, connect its server, let members join and sign in, link Discord to an account, and get every DM and channel post Gearbox sends today. Everything lands in one branch (`discord-support`) and one pull request.

Status: **built in this branch** (D.1 to D.8). The decisions below were confirmed on 16 October 2026. Discord stays off until its app is made and configured (`docs/deploy.md`, "Discord").

## What Slack does today

| # | What | Where |
| --- | --- | --- |
| S1 | A team admin installs the Slack app into the team's workspace (OAuth, bot token stored encrypted per team) | G3ID `routes/slack.ts` `/install`, `/oauth/callback`; `lib/slack-install.ts`; `slack_installations` |
| S2 | Team sign-up: "Add to Slack", then the founder DMs a code to the bot and becomes the first admin | Platform `src/index.ts` `/signup/*`; G3ID `/internal/slack-installations`, `/internal/signup-codes`; `apps/platform/src/signup-page.tsx` |
| S3 | Members sign up and sign in by sending a 4-digit code to the bot (DM or `/signin`). A new member is created pending, with the email from Slack | G3ID `lib/slack-code.ts`, `routes/slack.ts` `/events`, `/commands/*`, `routes/auth/slack.ts`; `core_slack_link_codes`; ID's `slack-login-page.tsx`, `signup-page.tsx` |
| S4 | A signed-in member links Slack (`/link` or a code DM) | Same; Portal `/account` |
| S5 | Admins get a DM when someone signs up and waits for approval | G3ID `lib/member-dm.ts` `dmAdmins` |
| S6 | DM to one member by Slack id (Orders: the request was approved) | `sendTeamDM` in `@g3/auth` → G3ID `/internal/teams/:id/slack/dm`; Orders stores `requester_slack_id` |
| S7 | DM to members by G3ID id (Schedule reminders, Scouting service tickets, operators hearing of a number report, platform notifications) | `sendMemberDM` → `/slack/dm-members` |
| S8 | DM to every admin (an app switched on or off) | Platform `team.ts` → `/slack/dm-admins` |
| S9 | Post to a channel (Shop's release and daily summary, platform notifications) | `sendTeamMessage` → `/slack/message`; channel IDs in Shop's `admin_settings` and the platform's `team_notification_settings.slack_channel` |
| S10 | Admins pick a channel by name, with a warning when the bot isn't in it | `SlackChannelPicker` in `@g3/ui`; G3ID `GET /admin/slack/channels` |
| S11 | Disconnect, and forget the token when the app is removed from the workspace | Integrations page; `app_uninstalled` / `tokens_revoked` events |
| S12 | Slack can't be switched off as a sign-in method: members join through it | G3ID `lib/sign-in-methods.ts` |
| S13 | A Slack link on Portal's resource links | `team-ui.ts` (`teamUiLinkLabels`, `defaultAppOrder`) |
| S14 | Everything else that names Slack: Integrations "uses", the members page's provider filter, page text in Orders, Schedule, Shop, Scouting and the console, the demo guard, staging's Slack app, the privacy and terms drafts | Many files; see the step list |

## How Discord differs

- **One bot token for the whole app**, not one per server. A team's connection is just its server (guild) id, so there is no team secret to encrypt. The token is one G3ID secret, `DISCORD_BOT_TOKEN`.
- **A bot can't read DMs without Discord's Gateway**, a WebSocket that must stay open. Workers can't hold one without a new always-on Durable Object. So the Slack code-by-DM flow doesn't carry over. Instead, **Discord sign-in is OAuth** (scopes `identify email`), like Google, and we check that the person is a member of the team's server with the bot (`GET /guilds/:guild/members/:user`). This is simpler for members than the code dance and needs no interactions endpoint, no slash commands and no Gateway.
- **One authorize does install and sign-in.** An authorize with `bot applications.commands identify email` installs the bot into a server the person manages and also signs them in. Team sign-up uses this, so the founder clicks once and becomes the first admin.
- **No event when the bot is removed** from a server over plain HTTP. A send that fails with "Unknown Guild" or "Missing Access" marks the team's Discord disconnected, and the Integrations page shows it.
- **Limits:** a message is at most 2,000 characters (Slack allows 4,000 in a DM and 40,000 in a channel), so long posts such as Shop's daily summary are split. A member can turn off DMs from server members (error 50007), which counts as "not sent", like a member without Slack.
- **IDs:** Discord IDs are 17–20 digit numbers and Slack's are letters (`C…`, `U…`), so a stored channel or user id says which service it is on. Existing columns need no migration to hold either.
- **Formatting:** Slack uses `*bold*`, `<url|label>` and `:emoji:` names; Discord uses `**bold**`, `[label](url)` and real emoji (a bot's `:wave:` shows as text).

## Design

### One chat layer in G3ID

G3ID stays the only worker that talks to Slack or Discord, and the only holder of tokens. A new `lib/chat.ts` puts both behind one set of functions:

- `chatForTeam(env, teamId)` → `{ provider: "slack" | "discord", ... } | null`
- `dmUsers(env, teamId, which, message)`: each matching active member with the provider linked (replaces `dmMembers`)
- `postToChannel(env, teamId, channelId, message)`
- `listChannels(env, teamId)`: name, id, whether the bot can post there

`@g3/discord` (a new package next to `@g3/slack`) is the REST client: open a DM, send, list channels, check permissions, get a member, run OAuth.

**Messages are written once.** Apps write Gearbox's chat format: the part of Discord's Markdown both services can show (`**bold**`, `[label](url)`, `> ` quotes, `<t:UNIX:f>` for a time each reader sees in their own zone, Unicode emoji, line breaks). Discord takes it as it is. The Slack sender converts it to mrkdwn (`toSlack` in `@g3/slack`, which turns `<t:…>` into Slack's `<!date>`). Every message an app sends was rewritten into it.

### Internal API (in the same PR, every caller moves)

| Today | After |
| --- | --- |
| `/internal/teams/:id/slack/dm` (by Slack id) | Removed. Orders sends by G3ID user id (`sendMemberDM`) and stops writing `requester_slack_id` (the column stays, unused) |
| `/slack/dm-members`, `/slack/dm-admins` | `/chat/dm-members`, `/chat/dm-admins` |
| `/slack/message` | `/chat/message`: a Slack or Discord channel id, refused when it isn't the team's connected service |
| `GET /admin/slack/channels` | `GET /admin/chat/channels` |

`@g3/auth`: `sendMemberDM` and `sendTeamMessage` keep their names and point at `/chat/*`. `sendTeamDM` and `userSlackId` are removed.

### Data

- **G3ID migration:** `discord_installations` (team id primary key, guild id unique, guild name, installed by, created and updated). `core_user_identities`' provider CHECK gains `discord` (a table rebuild, keeping its foreign keys). `team_sign_in_methods` accepts `discord`.
- **Platform migration:** `teams.discord_guild_id`, `discord_guild_name` for sign-up. `team_notification_settings.slack_channel` keeps its column; the API field becomes `channel`.
- **Shop:** the `slack_*_channel_id` settings rows hold either kind of id. The manifest keys become `releaseChannelId` and `summaryChannelId`, and its admin routes `/admin/chat/config` and `/admin/chat/daily-summary`.
- **Team Appearance:** a `discord` resource link (the server's invite address), with a tile key in `teamUiLinkLabels` and a place in `defaultAppOrder`.

### Pages

- **ID:** "Sign in with Discord" on the sign-in and sign-up pages, shown when the team has Discord connected. Someone who isn't in the team's server is told to join it first.
- **Portal:** a Discord card on Integrations (connect, disconnect, the server's name, what it's used for). Link Discord on Account. Discord in Members' provider filter and on a member's page. Discord on the Sign-in page. Notifications uses the shared channel picker.
- **Platform:** sign-up offers Slack or Discord (its step is `connect`, then `code` for Slack only). The founder's Discord sign-in is handed to the team's own address with a one-time token (G3ID's `/auth/handoff`), so the cookie is set on its domain. The console shows a team's Discord server.
- **`@g3/ui`:** `SlackChannelPicker` becomes `ChannelPicker`, for whichever service the team has. A `useTeamChat()` hook (G3ID's public `GET /team/chat`) gives the service, and `chatName()` its name, so page text says "Slack" or "Discord" instead of always "Slack".
- **Text in apps** that names Slack (Orders, Schedule, Shop, Scouting, Portal's home and Apps page, the console) uses the team's service name.

### Security and the demo

- OAuth state carries the team and the return address, like Google's (`lib/oauth-state.ts`), and callbacks are on `id.<platform>` (`signInCallbackApiUrl`).
- Sign-in only signs in the team's own members. Sign-up as a new member requires membership in the team's server. Emails are taken only when Discord says they're verified.
- `DEMO_BLOCKED` gains connecting and disconnecting Discord. The demo team has Discord off as a sign-in method.

## Steps (one PR, in this order)

| Step | What | Status |
| --- | --- | --- |
| D.1 | `@g3/discord` client, `toSlack` converter, and a fake `discord.com` for worker tests in `@g3/testing` | Done |
| D.2 | G3ID: the chat layer, migrations, `/chat/*` internal routes, existing Slack behavior unchanged (Slack tests still pass) | Done |
| D.3 | G3ID: connect and disconnect Discord (admin), sign in, sign up and link with Discord OAuth plus the server-membership check, admin DMs for pending members, sign-in methods | Done |
| D.4 | Callers move: Orders, Shop, Schedule, Scouting and the platform (notifications, app switching, operators) use the chat routes and the shared message format | Done |
| D.5 | Platform sign-up with Discord, and the console | Done |
| D.6 | Pages: ID, Portal (Integrations, Account, Members, Sign-in, Notifications, links), `ChannelPicker`, `useTeamChat`, app text | Done |
| D.7 | Demo guard, staging's Discord app (`infra/staging/resources.json`, `pnpm configure`), `staging:copy-team` leaving out `discord_installations` | Done |
| D.8 | Docs: CLAUDE.md, `docs/deploy.md` (making the Discord app: redirect URIs, bot permissions, secrets), roadmap, privacy and terms drafts (Discord as a processor; Discord user id and email); changesets | Done |

Tests: G3ID (install, OAuth sign-in and sign-up with and without server membership, link, DMs and channel posts on each service, disconnect after a send fails), platform (Discord sign-up, notification delivery), Shop (release post to a Discord channel, a long summary split in two), Schedule and Scouting DMs, the demo guard, the format converter.

## Decisions

| Decision | Choice | Status |
| --- | --- | --- |
| Discord is a new vendor (roadmap rule: needs the owners' yes) | Yes: free, no paid add-on, no new Cloudflare product | Confirmed 16 October 2026 |
| Can a team connect both Slack and Discord? | One at a time. Then DMs, the always-on sign-in method and the channel pickers each have one answer. A team switches by disconnecting one and connecting the other | Confirmed 16 October 2026 |
| How members sign in with Discord | Discord OAuth plus a server-membership check, instead of the Slack code flow (which would need the Gateway, an always-on Durable Object) | Confirmed 16 October 2026 |
| Separate Discord apps for production and staging | Yes, like Slack | Confirmed 16 October 2026 |
