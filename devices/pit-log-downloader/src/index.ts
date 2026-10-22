import * as fs from "node:fs";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import * as zlib from "node:zlib";
import express from "express";
import isOnline from "is-online";
import { NodeSSH } from "node-ssh";
import { config, parsePitUrl, parseTeamNumber, pitUrlFor, robotNetworkOf } from "./config.ts";
import {
  PairingError,
  UploadRefused,
  checkGearbox,
  currentPairing,
  deleteFromGearbox,
  gearboxStatus,
  inGearbox,
  noteInGearbox,
  pairWithGearbox,
  refreshGearboxLogs,
  reportStatus,
  teamAppearance,
  unpairFromGearbox,
  uploadLog,
} from "./gearbox.ts";
import type { LogStatus, MatchTypeName, Status, TrimView } from "./status.ts";
import { timeline, trim } from "./wpilog.ts";

const kLogFileRegex = /^akit_[^_]+_[^_]+_[^_]+_[qep]\d+\.wpilog$/;
const kRioLogDirs = ["/u/logs", "/home/lvuser/logs"];
const kLogsJson = path.join(config.dataDir, "logs.json");
const kLogsDir = path.join(config.dataDir, "logs");

const ssh = new NodeSSH();

/** On the robot's network (an address in 10.TE.AM.x). */
let robotConnected = false;
/** Whether the roboRIO answered the last time it was tried, while on its network; null before. */
let rioReachable: boolean | null = null;
/** Listing and copying the robot's logs, which runs beside the loop; null when it isn't. */
let rioCheck: Promise<void> | null = null;
let lastRioCheck = 0;
/** While on the robot's network, its logs are listed again this often: new matches, or a retry. */
const kRioCheckMs = 30_000;
/** A copy that moves no bytes for this long is stopped (and tried again at the next check). */
const kStallMs = 30_000;
let lastStatusReport = 0;
let lastGearboxLogsCheck = 0;
let uploadingRunning = false;
/** Pit said it's full and keeps what it has: uploads wait until then (ms). */
let pitFullUntil = 0;

/** The largest log Pit takes, gzipped: a bigger one is trimmed first. */
const kMaxUploadSize = 40 * 1024 * 1024;
/** How long uploads wait after Pit says it's full. */
const kFullRetryMs = 5 * 60 * 1000;
const gzip = promisify(zlib.gzip);
// Live state surfaced by the status endpoint / dashboard.
let internetConnected = false;
let lastInternetCheck = 0;
let lastGearboxCheck = 0;
let rioLogs: { id: string; name: string; filename: string; origin: string }[] = [];
let rioLogsCheckedAt: number | null = null;
let downloadingIds: string[] = [];
let uploadingId: string | null = null;
const activity: { id: number; time: string; message: string }[] = [];
let activityCount = 0;
const kPackageDir = path.join(import.meta.dirname, "..");
/**
 * The command that starts it again, for the status page to show if it stops: from this Gearbox
 * folder, as it was started (with --dev or not). Windows PowerShell 5 has no `&&`, so `;` there.
 */
const kRestartCommand = [
  `cd "${path.resolve(kPackageDir, "../..")}"`,
  `pnpm --filter @g3/pit-log-downloader start${config.devGateway ? " -- --dev" : ""}`,
].join(process.platform === "win32" ? "; " : " && ");
const kVersion: string = JSON.parse(
  fs.readFileSync(path.join(kPackageDir, "package.json"), "utf8"),
).version;

type MatchType = "e" | "q" | "p";

type Log = {
  name: string;
  id: string;
  status: {
    downloaded: boolean;
    /** In the team's Pit on Gearbox. */
    uploaded: boolean;
  };
  /** Kept to [fromUs, toUs] when uploaded (log timestamps, microseconds); the file itself isn't cut. */
  trim?: { fromUs: number; toUs: number };
  /** What it comes to gzipped for Pit (trimmed, if it is), once worked out. */
  uploadSize?: number;
  /**
   * Deleted from this computer on the status page. The record stays, so it isn't copied off the
   * robot again; it's left out of everything else.
   */
  deleted?: boolean;
  match: {
    event: string;
    type: MatchType;
    number: number;
  };
  locations: {
    rio: {
      path: string;
      origin: string;
    };
  };
};

function getPrefixFromMatchType(matchType: MatchType) {
  switch (matchType) {
    case "e":
      return "Elim-";
    case "q":
      return "Qual-";
    case "p":
      return "Prct-";
  }
}

/** Where a log is kept on this computer: worked out each time, so the data folder can move. */
function localPathOf(log: Log) {
  return path.join(kLogsDir, path.basename(log.match.event), `${log.name}.wpilog`);
}

fs.mkdirSync(config.dataDir, { recursive: true });
if (!fs.existsSync(kLogsJson)) {
  fs.writeFileSync(kLogsJson, "[]");
}

// Older versions saved each log's absolute path (locations.localPath) and where it was in Google
// Drive (status.inDrive, locations.drive); both are dropped on load, and a log not yet in
// Gearbox is uploaded.
const logs: Log[] = (JSON.parse(fs.readFileSync(kLogsJson).toString()) as Log[]).map((log) => ({
  ...log,
  status: { downloaded: log.status.downloaded, uploaded: log.status.uploaded === true },
  ...(log.trim ? { trim: log.trim } : {}),
  ...(log.uploadSize ? { uploadSize: log.uploadSize } : {}),
  ...(log.deleted ? { deleted: true } : {}),
  locations: { rio: log.locations.rio },
}));

/** The paired team's robot network ("10.16.48"), or null before pairing. */
function robotNetwork() {
  const pairing = currentPairing();
  return pairing ? robotNetworkOf(pairing.teamNumber) : null;
}

{
  const pairing = currentPairing();
  const page = `http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`;
  logWithTimestamp(
    pairing
      ? `Paired with team ${pairing.teamNumber}'s Pit as ${pairing.name}. Logs are kept in ${kLogsDir}.`
      : `Not paired with Gearbox yet: open ${page} to pair it.`,
  );
  if (config.devGateway) {
    logWithTimestamp(`--dev: pairing through the dev gateway, at ${pitUrlFor("<team>")}.`);
  }
}

let running = false;
async function poll() {
  if (!running) {
    running = true;
    await logicLoop();
    running = false;
  }
  setTimeout(poll, 3000);
}
poll();

async function logicLoop() {
  // Internet checks hit the network, so they run on a slower cadence than the poll.
  if (Date.now() - lastInternetCheck > 15000) {
    lastInternetCheck = Date.now();
    internetConnected = await isOnline().catch(() => false);
  }

  // Whether Gearbox still knows this downloader, once a minute while it's online.
  if (currentPairing() && internetConnected && Date.now() - lastGearboxCheck > 60_000) {
    lastGearboxCheck = Date.now();
    await checkGearbox();
  }

  // Which logs Pit has, once a minute while online: one deleted there isn't "In Gearbox".
  if (currentPairing() && internetConnected && Date.now() - lastGearboxLogsCheck > 60_000) {
    lastGearboxLogsCheck = Date.now();
    await refreshGearboxLogs();
  }

  // Nothing else until it's paired (again): pairing is what gives it its team.
  const network = robotNetwork();
  if (!network) {
    if (robotConnected) logWithTimestamp("Stopped until it's paired with Gearbox again.");
    robotConnected = false;
    rioReachable = null;
    return;
  }

  // The robot is connected as soon as this computer is on its network, whatever is copying.
  const onNetwork = isRobotNetworkConnected(network);
  if (onNetwork !== robotConnected) {
    logWithTimestamp(onNetwork ? "Robot network found." : "Robot network lost.");
    robotConnected = onNetwork;
    // A copy in progress can't finish now: closing the connection ends it at once.
    if (!onNetwork) ssh.dispose();
    rioReachable = null;
    lastRioCheck = 0;
  }

  // Its logs are listed and copied beside the loop, so the page and uploads never wait for it,
  // and listed again every so often while connected (new matches, or a roboRIO that didn't answer).
  if (onNetwork && !rioCheck && Date.now() - lastRioCheck > kRioCheckMs) {
    lastRioCheck = Date.now();
    rioCheck = downloadLogs(`${network}.2`)
      .then((reached) => {
        if (robotConnected) rioReachable = reached;
      })
      .finally(() => {
        rioCheck = null;
        saveLogs();
      });
  }

  // Sizes are worked out offline too, so a log that needs trimming says so at once.
  uploadLogs(internetConnected).catch((err) => logWithTimestamp(`Could not upload logs: ${err}`));

  // What it's doing, for Pit's Logs page and Monitor, every 10 s while online.
  if (currentPairing() && internetConnected && Date.now() - lastStatusReport > 10_000) {
    lastStatusReport = Date.now();
    void reportStatus({
      robot: robotConnected,
      rioReachable,
      copying: downloadingIds.length,
      uploading: logs.find((log) => log.id === uploadingId)?.name ?? null,
      pendingUpload: logs.filter(
        (log) => log.status.downloaded && !log.status.uploaded && !log.deleted && !needsTrim(log),
      ).length,
      version: kVersion,
    });
  }

  saveLogs();
}

function isRobotNetworkConnected(network: string) {
  return Object.values(os.networkInterfaces())
    .flat()
    .some((n) => n?.address.startsWith(`${network}.`));
}

async function downloadLogs(rioIp: string) {
  try {
    await ssh.connect({
      host: rioIp,
      username: "admin",
      password: "",
      readyTimeout: 10_000,
      // A network that goes away mid-copy closes the connection (about 15 s), instead of
      // leaving the copy waiting forever.
      keepaliveInterval: 5_000,
      keepaliveCountMax: 3,
    });
  } catch (err) {
    // Said once, not on every try while it doesn't answer.
    if (rioReachable !== false) logWithTimestamp(`Could not connect to the roboRIO: ${err}`);
    return false;
  }

  const foundOnRio: typeof rioLogs = [];
  /** The connection closed midway: what was found isn't the whole list. */
  let cutOff = false;

  try {
    const sftp = await ssh.requestSFTP();

    const readdirAsync = (dir: string) =>
      new Promise<string[]>((resolve, reject) =>
        // Typed here: @types/ssh2 would bring an old @types/node into the whole workspace.
        sftp.readdir(dir, (err: Error | undefined, list: { filename: string }[]) =>
          err ? reject(err) : resolve(list.map((i) => i.filename)),
        ),
      );

    origins: for (const origin of kRioLogDirs) {
      const res = await readdirAsync(origin).catch(() =>
        logWithTimestamp(`Could not read dir: ${origin}`),
      );
      if (!res) continue;

      const list = res.filter((filename) => kLogFileRegex.test(filename));

      for (const filename of list) {
        const splitByUS = filename.split("_");
        const event = splitByUS[3];
        const match = splitByUS[4].split(".")[0];
        const matchType = match.substring(0, 1) as MatchType;
        const matchNumber = match.substring(1);
        const friendlyName = getPrefixFromMatchType(matchType) + matchNumber;

        const log: Log = {
          name: friendlyName,
          id: `${event}-${matchType}-${matchNumber}`,
          status: {
            downloaded: true,
            uploaded: false,
          },
          match: {
            event,
            type: matchType,
            number: Number.parseInt(matchNumber),
          },
          locations: {
            // The roboRIO's paths always use "/", whatever this computer uses.
            rio: {
              path: `${origin}/${filename}`,
              origin,
            },
          },
        };

        foundOnRio.push({ id: log.id, name: log.name, filename, origin });

        if (!logs.some((l) => l.id === log.id && l.status.downloaded)) {
          logWithTimestamp(`Copying ${log.name} off the robot.`);
          downloadingIds.push(log.id);
          // Copied beside the log, then renamed: a copy cut off midway never looks like a log.
          const localPath = localPathOf(log);
          const partPath = `${localPath}.part`;
          // A copy that stops moving (or the robot's network going) closes the connection, which
          // ends the copy as a failure; the next check copies it again.
          let lastProgress = Date.now();
          const watchdog = setInterval(() => {
            if (!robotConnected || Date.now() - lastProgress > kStallMs) ssh.dispose();
          }, 1000);
          try {
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            await ssh.getFile(partPath, log.locations.rio.path, null, {
              step: () => {
                lastProgress = Date.now();
              },
            });
            fs.renameSync(partPath, localPath);
            logs.push(log);
          } catch (err) {
            fs.rmSync(partPath, { force: true });
            logWithTimestamp(
              robotConnected
                ? `Could not copy ${log.name} off the robot. Trying again soon.`
                : `Copying ${log.name} stopped: the robot's network is gone.`,
            );
            // The connection is gone with it: the rest wait for the next check.
            if (!ssh.isConnected()) {
              cutOff = true;
              break origins;
            }
          } finally {
            clearInterval(watchdog);
            downloadingIds = downloadingIds.filter((id) => id !== log.id);
          }
        }
      }
    }
  } catch (err) {
    logWithTimestamp(`Uncaught error downloading logs: ${err}`);
    return false;
  } finally {
    ssh.dispose();
  }
  if (cutOff) return false;

  rioLogs = foundOnRio;
  rioLogsCheckedAt = Date.now();

  return true;
}

function saveLogs() {
  fs.writeFileSync(kLogsJson, JSON.stringify(logs));
}

/** The log as it goes to Pit: trimmed, if it is, and gzipped. Notes its size. */
async function prepare(log: Log) {
  const file = await fs.promises.readFile(localPathOf(log));
  const source = log.trim ? trim(file, log.trim.fromUs, log.trim.toUs) : file;
  const gzipped = await gzip(source, { level: 9 });
  log.uploadSize = gzipped.length;
  return { gzipped, rawSize: source.length };
}

const needsTrim = (log: Log) => (log.uploadSize ?? 0) > kMaxUploadSize;

/**
 * Uploads every copied log Gearbox doesn't have yet to the team's Pit, one at a time, when
 * `online`; offline, only works out sizes. A log over the limit waits until it's trimmed.
 */
async function uploadLogs(online: boolean) {
  if (uploadingRunning) return;
  uploadingRunning = true;
  try {
    for (const log of logs) {
      if (!log.status.downloaded || log.status.uploaded || log.deleted) continue;
      if (!currentPairing()) return;
      if (!fs.existsSync(localPathOf(log))) continue;
      if (log.uploadSize !== undefined && (needsTrim(log) || !online)) continue;
      if (online && Date.now() < pitFullUntil) return;

      const prepared = await prepare(log);
      saveLogs();
      if (needsTrim(log) || !online) continue;

      uploadingId = log.id;
      try {
        const done = await uploadLog({
          event: log.match.event,
          name: log.name,
          matchType: log.match.type,
          matchNumber: log.match.number,
          gzipped: prepared.gzipped,
          rawSize: prepared.rawSize,
          trimmed: Boolean(log.trim),
        });
        log.status.uploaded = true;
        noteInGearbox(log.match.event, log.name, true);
        saveLogs();
        logWithTimestamp(
          done === "uploaded"
            ? `Uploaded ${log.name} to Gearbox.`
            : `Gearbox already has ${log.name}.`,
        );
      } catch (err) {
        if (err instanceof UploadRefused && err.reason === "full") {
          pitFullUntil = Date.now() + kFullRetryMs;
        }
        logWithTimestamp(
          `Could not upload ${log.name}: ${err instanceof Error ? err.message : err}`,
        );
        return; // Tried again on a later pass.
      } finally {
        uploadingId = null;
      }
    }
  } finally {
    uploadingRunning = false;
  }
}

function logWithTimestamp(message: string) {
  const date = new Date();
  const pn = (n: number) => n.toString().padStart(2, "0");
  const time = `${pn(date.getHours())}:${pn(date.getMinutes())}:${pn(date.getSeconds())}`;
  console.log(`${message} (${time})`);

  activity.unshift({ id: ++activityCount, time, message });
  if (activity.length > 100) activity.length = 100;
}

const app = express();

// The API is for the status page on this computer. A page from anywhere else reaching it through a
// name that points here (DNS rebinding) is turned away by the Host check, unless HOST opens the
// page to other computers; and a change must be JSON, which no other site's page can send here
// without the browser asking first.
const kLoopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const kOpen = !kLoopback.has(config.host);
app.use("/api", (req, res, next) => {
  if (!kOpen && !kLoopback.has(req.hostname)) {
    res.status(403).json({ error: "Open the status page at localhost." });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && !req.is("application/json")) {
    res.status(415).json({ error: "Send JSON." });
    return;
  }
  next();
});
app.use("/api", express.json());

// Everything the status page shows, in one payload.
app.get("/api/status", (_req, res) => {
  const matchTypeNames: Record<MatchType, MatchTypeName> = {
    e: "Elimination",
    q: "Qualification",
    p: "Practice",
  };

  const decorated = logs
    .filter((log) => !log.deleted)
    .map((log): LogStatus => {
      const localPath = localPathOf(log);
      let sizeBytes: number | null = null;
      try {
        sizeBytes = fs.statSync(localPath).size;
      } catch {
        /* file was moved or deleted outside of this process */
      }

      return {
        id: log.id,
        name: log.name,
        event: log.match.event,
        matchType: matchTypeNames[log.match.type],
        matchNumber: log.match.number,
        downloaded: log.status.downloaded,
        uploaded: log.status.uploaded,
        inGearbox: inGearbox(log.match.event, log.name),
        trimmed: Boolean(log.trim),
        uploadSize: log.uploadSize ?? null,
        needsTrim: needsTrim(log),
        onRobot: rioLogs.some((r) => r.id === log.id),
        downloading: downloadingIds.includes(log.id),
        uploading: uploadingId === log.id,
        localPath,
        localFile: path.basename(localPath),
        rioPath: log.locations.rio.path,
        sizeBytes,
      };
    });

  const status: Status = {
    version: kVersion,
    restartCommand: kRestartCommand,
    gearbox: gearboxStatus(),
    connection: {
      robot: robotConnected,
      rioReachable,
      internet: internetConnected,
      uploadingRunning,
      pitFull: Date.now() < pitFullUntil,
      uploadingId,
      downloadingIds,
      rioLogsCheckedAt,
    },
    settings: {
      teamNumber: currentPairing()?.teamNumber ?? null,
      robotNetwork: robotNetwork(),
      rioIp: robotNetwork() && `${robotNetwork()}.2`,
      rioLogDirs: kRioLogDirs,
      localLogsDir: kLogsDir,
    },
    counts: {
      downloaded: decorated.filter((l) => l.downloaded).length,
      uploaded: decorated.filter((l) => l.inGearbox ?? l.uploaded).length,
      pendingUpload: decorated.filter((l) => l.downloaded && !l.uploaded && !l.needsTrim).length,
      needsTrim: decorated.filter((l) => l.needsTrim && !l.uploaded).length,
      onRobot: rioLogs.length,
    },
    rioLogs: rioLogs.map((r) => ({
      ...r,
      downloaded: logs.some((l) => l.id === r.id && l.status.downloaded),
    })),
    logs: decorated,
    activity,
  };
  res.json(status);
});

// Download a specific log file
app.get("/api/download", (req, res) => {
  const event = req.query.event;
  const file = req.query.file;

  if (typeof event !== "string" || typeof file !== "string" || !event || !file) {
    return res.status(400).send("Missing event or file parameter.");
  }

  // Sanitize both segments to prevent path traversal
  const filePath = path.join(kLogsDir, path.basename(event), path.basename(file));

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found.");
  }

  res.download(filePath);
});

// Pairing with the team's Pit on Gearbox, with a code from Pit's Logs page.
app.post("/api/gearbox/pair", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.replace(/\s/g, "") : "";
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  const teamNumber = parseTeamNumber(req.body?.teamNumber);
  if (!teamNumber) {
    res.status(400).json({ error: "Enter your FRC team number." });
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    res.status(400).json({ error: "The code is 6 digits." });
    return;
  }
  // Another Pit than the team's usual one, typed on the pairing form (staging, a Pit of its own).
  const typedUrl = typeof req.body?.pitUrl === "string" ? req.body.pitUrl.trim() : "";
  const chosenUrl = typedUrl ? parsePitUrl(typedUrl) : null;
  if (typedUrl && !chosenUrl) {
    res.status(400).json({ error: `Enter the Pit's address, like ${pitUrlFor(teamNumber)}.` });
    return;
  }
  try {
    await pairWithGearbox(teamNumber, code, name, chosenUrl);
    logWithTimestamp(`Paired with team ${teamNumber}'s Pit at ${currentPairing()?.pitUrl}.`);
    res.json(gearboxStatus());
  } catch (err) {
    const message = err instanceof PairingError ? err.message : "Couldn't pair with Gearbox.";
    if (!(err instanceof PairingError)) console.error(err);
    res.status(400).json({ error: message });
  }
});

// The paired team's appearance, which the page's @g3/ui loads as G3ID's /team/ui (vite.config).
app.get("/api/gearbox/team/ui", async (_req, res) => {
  const settings = await teamAppearance();
  if (!settings) {
    res.status(404).json({ error: "Not paired with Gearbox." });
    return;
  }
  res.set("Cache-Control", "no-store").json(settings);
});

// Trimming a log: what's in it over time, and keeping part of it when it's uploaded.
async function trimView(log: Log): Promise<TrimView> {
  const file = await fs.promises.readFile(localPathOf(log));
  const view = timeline(file);
  const toSeconds = (us: number) => (us - view.startUs) / 1e6;
  return {
    duration: view.duration,
    bytesPerSecond: view.bytesPerSecond,
    enabled: view.enabled,
    autonomous: view.autonomous,
    suggested: view.suggested,
    trim: log.trim ? [toSeconds(log.trim.fromUs), toSeconds(log.trim.toUs)] : null,
    rawSize: file.length,
    uploadSize: log.uploadSize ?? null,
    maxUploadSize: kMaxUploadSize,
  };
}

// Deletes a log from this computer, and from Gearbox too with { alsoFromGearbox: true } (first, so
// nothing is deleted here when Gearbox can't be reached). It isn't copied off the robot again.
app.delete("/api/logs/:id", async (req, res) => {
  const log = logs.find((l) => l.id === req.params.id && !l.deleted);
  if (!log) {
    res.status(404).json({ error: "That log isn't on this computer." });
    return;
  }
  if (uploadingId === log.id) {
    res.status(409).json({ error: "It's uploading now. Try again in a moment." });
    return;
  }
  if (req.body?.alsoFromGearbox === true) {
    try {
      await deleteFromGearbox(log.match.event, log.name);
    } catch (err) {
      res.status(502).json({
        error: `${err instanceof Error ? err.message : err} Nothing was deleted.`,
      });
      return;
    }
    noteInGearbox(log.match.event, log.name, false);
    logWithTimestamp(`Deleted ${log.name} from Gearbox.`);
  }
  fs.rmSync(localPathOf(log), { force: true });
  log.deleted = true;
  log.uploadSize = undefined;
  log.trim = undefined;
  saveLogs();
  logWithTimestamp(`Deleted ${log.name} from this computer.`);
  res.json({ ok: true });
});

app.get("/api/logs/:id/trim", async (req, res) => {
  const log = logs.find((l) => l.id === req.params.id);
  if (!log || !fs.existsSync(localPathOf(log))) {
    res.status(404).json({ error: "That log isn't on this computer." });
    return;
  }
  res.json(await trimView(log));
});

// { from, to } in seconds keeps that part; { from: null } keeps all of it. It's uploaded again.
app.post("/api/logs/:id/trim", async (req, res) => {
  const log = logs.find((l) => l.id === req.params.id);
  if (!log || !fs.existsSync(localPathOf(log))) {
    res.status(404).json({ error: "That log isn't on this computer." });
    return;
  }
  const from = req.body?.from;
  const to = req.body?.to;
  if (from === null) {
    log.trim = undefined;
  } else if (typeof from === "number" && typeof to === "number" && from >= 0 && to > from) {
    const { startUs } = timeline(await fs.promises.readFile(localPathOf(log)));
    log.trim = { fromUs: startUs + Math.round(from * 1e6), toUs: startUs + Math.round(to * 1e6) };
  } else {
    res.status(400).json({ error: "Choose where the log starts and ends." });
    return;
  }
  log.status.uploaded = false;
  await prepare(log);
  saveLogs();
  logWithTimestamp(
    log.trim ? `Trimmed ${log.name} for Gearbox.` : `${log.name} goes to Gearbox whole.`,
  );
  res.json(await trimView(log));
});

app.delete("/api/gearbox", async (_req, res) => {
  await unpairFromGearbox();
  logWithTimestamp("Unpaired from Gearbox. It does nothing until it's paired again.");
  res.json(gearboxStatus());
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

const server = createServer(app);

if (process.argv.includes("--watch-page")) {
  // `watch` (--watch-page): the page is served by Vite, which reloads it as its files change.
  const { createServer: createVite } = await import("vite");
  const vite = await createVite({
    configFile: path.join(kPackageDir, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  // `start` builds the page first.
  const webDir = path.join(kPackageDir, "dist", "web");
  app.use(express.static(webDir));
  app.use((_req, res) => {
    const page = path.join(webDir, "index.html");
    if (fs.existsSync(page)) res.sendFile(page);
    else
      res
        .status(503)
        .send("The status page isn't built. Run: pnpm --filter @g3/pit-log-downloader build");
  });
}

server.listen(config.port, config.host, () => {
  const shown = config.host === "0.0.0.0" ? "localhost" : config.host;
  logWithTimestamp(`Status page running at http://${shown}:${config.port}`);
});
