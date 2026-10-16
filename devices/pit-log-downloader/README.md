# Pit log downloader

Runs on a computer in the pit. Whenever the computer joins the robot's network, it copies the
[AdvantageKit](https://docs.advantagekit.org/) match logs (`.wpilog`) off the roboRIO, names them
by match (`Qual-13.wpilog`, `Elim-2.wpilog`, `Prct-0.wpilog`) and sorts them by event. If you give
it a Google Drive folder, it also uploads them there, one folder per event, once the computer is
online again.

It runs on Linux, Windows and macOS. A status page at <http://localhost:3000>, in the same style
as the other Gearbox apps, shows the robot and internet connection and every log and where it is,
and lets you download them or copy their path (to open in AdvantageScope).

Logs are only found if their names follow AdvantageKit's pattern with an event and match, like
`akit_26-04-30_14-40-08_archimedes_q13.wpilog`. They're read from `/u/logs` (a USB drive) and
`/home/lvuser/logs` on the roboRIO, and are never deleted from it.

## Setting up a computer

You need [Node.js 24](https://nodejs.org/) or newer and [Git](https://git-scm.com/).

1. Turn on pnpm, which comes with Node.js:

   ```sh
   corepack enable
   ```

2. Get the code and install only what the downloader needs:

   ```sh
   git clone https://github.com/midtownrobotics/Gearbox.git
   cd Gearbox
   pnpm install --filter "@g3/pit-log-downloader..."
   ```

3. In `devices/pit-log-downloader`, copy `config.env.example` to `config.env` and set
   `TEAM_NUMBER` to your team's number.

4. To upload to Google Drive (optional):
   1. In the [Google Cloud console](https://console.cloud.google.com/), make a project, turn on
      the Google Drive API and make a service account. Make a JSON key for it.
   2. Save the key as `devices/pit-log-downloader/service-account-key.json` (or set
      `GOOGLE_KEY_FILE` to where it is). Keep it secret: anyone with it can use the folder.
   3. Share the Drive folder with the service account's email address as an Editor. The folder
      can be in a shared drive.
   4. Set `DRIVE_FOLDER_ID` to the folder's ID, the last part of its address:
      `https://drive.google.com/drive/folders/<FOLDER ID>`.

## Running it

From the `Gearbox` folder:

```sh
pnpm --filter @g3/pit-log-downloader start
```

It builds the status page first, which takes a few seconds. Leave it running, connect to the
robot's network (over Wi-Fi, Ethernet or USB) and open <http://localhost:3000>. Stop it with
Ctrl+C.

## Working on it

```sh
pnpm --filter @g3/pit-log-downloader watch
```

restarts the downloader when `src/` changes and reloads the status page as you edit it.

- `src/`: the downloader and its API (`/api/status`, `/api/download`), on Node with Express.
  `src/status.ts` is what `/api/status` answers, shared with the page.
- `web/`: the status page, in React with Vite and Tailwind, built from the shared Gearbox parts
  (`@g3/ui`). It has the Gearbox top bar with no team: the built-in colors, light and dark mode,
  and no sign-in. `start` builds it into `dist/web`; `watch` serves it through Vite instead.

## Pairing with Gearbox

Pairing connects the downloader to your team's Pit on Gearbox (for now it only pairs; listing
logs in Pit comes next).

1. On Pit's **Logs** page, a mentor or admin chooses **Get a pairing code**.
2. On the status page, choose **Pair with Gearbox** and enter the code within 10 minutes. The
   computer's name is what Pit lists it as.

The downloader keeps its key in `data/gearbox.json` (readable only by you). Unpair on the status
page, or remove it on Pit's Logs page; either stops the key working. It pairs with
`https://<TEAM_NUMBER>-pit.frcgearbox.com` unless `PIT_URL` says otherwise.

## Settings

All are in `config.env`. Relative paths start from `devices/pit-log-downloader`.

| Setting | What it is | Default |
| --- | --- | --- |
| `TEAM_NUMBER` | Your FRC team number. The roboRIO is found at `10.TE.AM.2` | Required |
| `DRIVE_FOLDER_ID` | The Google Drive folder logs are uploaded to | None: logs stay on the computer |
| `GOOGLE_KEY_FILE` | The service account's JSON key | `service-account-key.json` |
| `DATA_DIR` | Where logs and the list of them (`logs.json`) are kept | `data` |
| `PORT` | The status page's port | `3000` |
| `PIT_URL` | The team's Pit to pair with | `https://<TEAM_NUMBER>-pit.frcgearbox.com` |
| `HOST` | Who can open the status page: `127.0.0.1` for this computer only, `0.0.0.0` for anyone on its networks | `127.0.0.1` |

## Moving from the old Pit-Log-Downloader repository

Copy its `logs.json` and `logs` folder into `devices/pit-log-downloader/data/`, and its
`service-account-key.json` into `devices/pit-log-downloader/`. Logs it already downloaded or
uploaded aren't downloaded or uploaded again.

## Checking a change

```sh
pnpm --filter @g3/pit-log-downloader typecheck
pnpm --filter @g3/pit-log-downloader smoke
```

`smoke` builds the page, starts the downloader with no robot and no Drive, and checks that its
API and page answer. CI runs both on Linux, Windows and macOS.
