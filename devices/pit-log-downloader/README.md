# Pit log downloader

Runs on a computer in the pit. Whenever the computer joins the robot's network, it copies the
[AdvantageKit](https://docs.advantagekit.org/) match logs (`.wpilog`) off the roboRIO, names them
by match (`Qual-13.wpilog`, `Elim-2.wpilog`, `Prct-0.wpilog`) and sorts them by event. Once the
computer is online again, it uploads them to your team's Pit on Gearbox, where anyone on the
team downloads them from the Logs page.

It runs on Linux, Windows and macOS. A status page at <http://localhost:3000>, in the same style
as the other Gearbox apps, shows the robot and internet connection and every log and where it is,
and lets you download them or copy their path (to open in AdvantageScope).

Logs are only found if their names follow AdvantageKit's pattern with an event and match, like
`akit_26-04-30_14-40-08_archimedes_q13.wpilog`. They're read from `/u/logs` (a USB drive) and
`/home/lvuser/logs` on the roboRIO, and are never deleted from it.

## Setting up a computer

Pit's **Logs** page has these steps for Windows, macOS and Linux, with commands to copy. In short:
you need [Git](https://git-scm.com/) and [Node.js 24](https://nodejs.org/) or newer, then

```sh
npm install -g pnpm
git clone https://github.com/midtownrobotics/Gearbox.git
cd Gearbox
pnpm install --filter "@g3/pit-log-downloader..."
pnpm --filter @g3/pit-log-downloader start
```

`start` builds the status page, which takes a few seconds, then runs the downloader. Open
<http://localhost:3000> and leave it running. Stop it with Ctrl+C.

## Pairing with Gearbox

The downloader does nothing until it's paired with your team's Pit on Gearbox, which is how it
knows its team: on first start, the status page only asks to pair.

1. On Pit's **Logs** page, a mentor or admin chooses **Get a pairing code**.
2. On the status page, enter your team number and the code within 10 minutes. The computer's
   name is what Pit lists it as.

Then the status page takes your team's colors, names and logo from Gearbox, and it copies logs
(and uploads them to Pit once online) whenever the computer joins the robot's network (`10.TE.AM.x`, from the team
number). It keeps its key in `data/gearbox.json` (readable only by you). Unpairing on the status
page, or removing it on Pit's Logs page, stops it until it's paired again with a new code.

## Limits and trimming

Logs are gzipped before they're uploaded, which takes them to about 40% of their size. Gearbox
takes logs up to **40 MB** gzipped and keeps **20** per team; when it's full, it either keeps what
it has (the default) or replaces the oldest, as a mentor chooses on Pit's Logs page.

A log over 40 MB gzipped waits on this computer until it's trimmed: its **Trim** button shows the
log's data over time with the robot's enabled time shaded, and **Suggested trim** keeps from a
little before the robot was first enabled to a little after it was last disabled. Only what's
uploaded is trimmed: the whole log stays on this computer. Any log can be trimmed.

## Settings

None are needed. To change one, copy `config.env.example` to `config.env` in
`devices/pit-log-downloader`. Relative paths start from that folder.

| Setting | What it is | Default |
| --- | --- | --- |
| `DATA_DIR` | Where logs, the list of them (`logs.json`) and the pairing are kept | `data` |
| `PORT` | The status page's port | `3000` |
| `HOST` | Who can open the status page: `127.0.0.1` for this computer only, `0.0.0.0` for anyone on its networks | `127.0.0.1` |
| `PIT_URL` | The Pit to pair with, when it isn't the team's usual address (staging) | `https://<team>-pit.frcgearbox.com` |

## Working on it

```sh
pnpm --filter @g3/pit-log-downloader start -- --dev   # pairs with the Pit under `pnpm dev`
pnpm --filter @g3/pit-log-downloader watch -- --dev   # the same, reloading as you edit
```

`--dev` pairs with the team's Pit under `pnpm dev`, through the dev gateway
(`http://1648-pit.gearbox.localhost:8796`, the gateway's address from the repo's
`.dev-ports.json`), instead of its Pit on Gearbox. A team other than the site's needs to be
signed up in the local platform first. A pairing made
with or without it only works the same way: switching asks to pair again. `watch` restarts the
downloader when `src/` changes and reloads the status page as you edit it.

- `src/`: the downloader and its API (`/api/status`, `/api/download`, `/api/gearbox`), on Node
  with Express. `src/status.ts` is what `/api/status` answers, shared with the page.
- `web/`: the status page, in React with Vite and Tailwind, built from the shared Gearbox parts
  (`@g3/ui`). It has the Gearbox top bar with no sign-in, light and dark mode, and once paired
  the team's Team Appearance from Gearbox (kept in `data/appearance.json` for when it's
  offline). `start` builds it into `dist/web`; `watch` serves it through Vite instead.

## Moving from the old Pit-Log-Downloader repository

Copy its `logs.json` and `logs` folder into `devices/pit-log-downloader/data/` and pair it. Logs
it already downloaded aren't downloaded again, and they're uploaded to Gearbox (Google Drive and
its `TEAM_NUMBER`, `DRIVE_FOLDER_ID` and key file aren't used any more).

## Checking a change

```sh
pnpm --filter @g3/pit-log-downloader typecheck
pnpm --filter @g3/pit-log-downloader smoke
```

`smoke` builds the page, starts the downloader with no settings, no robot and no pairing, and
checks that its API and page answer. CI runs both on Linux, Windows and macOS.
