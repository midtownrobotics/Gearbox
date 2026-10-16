import * as fs from "node:fs";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import express from "express";
import { type drive_v3, google } from "googleapis";
import isOnline from "is-online";
import { NodeSSH } from "node-ssh";
import { config, parseTeamNumber, pitUrlFor, robotNetworkOf } from "./config.ts";
import {
  PairingError,
  checkGearbox,
  currentPairing,
  gearboxStatus,
  pairWithGearbox,
  teamAppearance,
  unpairFromGearbox,
} from "./gearbox.ts";
import type { LogStatus, MatchTypeName, Status } from "./status.ts";

const kLogFolderId = config.driveFolderId;
const kLogFileRegex = /^akit_[^_]+_[^_]+_[^_]+_[qep]\d+\.wpilog$/;
const kRioLogDirs = ["/u/logs", "/home/lvuser/logs"];
const kLogsJson = path.join(config.dataDir, "logs.json");
const kLogsDir = path.join(config.dataDir, "logs");

const ssh = new NodeSSH();
const auth = new google.auth.GoogleAuth({
  keyFile: config.googleKeyFile,
  scopes: ["https://www.googleapis.com/auth/drive"],
});

let robotConnected = false;
let driveUpdating = false;

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
    inDrive: boolean;
  };
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
    drive?: {
      fileId: string;
      folderId: string;
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

// Older versions saved each log's absolute path as locations.localPath; it's dropped on load.
const logs: Log[] = (JSON.parse(fs.readFileSync(kLogsJson).toString()) as Log[]).map((log) => {
  const { rio, drive } = log.locations;
  return { ...log, locations: drive ? { rio, drive } : { rio } };
});

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
if (!kLogFolderId) {
  logWithTimestamp("No DRIVE_FOLDER_ID is set, so logs stay on this computer.");
} else if (!fs.existsSync(config.googleKeyFile)) {
  logWithTimestamp(`Google key file not found: ${config.googleKeyFile}. Drive uploads will fail.`);
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

  // Nothing else until it's paired (again): pairing is what gives it its team.
  const network = robotNetwork();
  if (!network) {
    if (robotConnected) logWithTimestamp("Stopped until it's paired with Gearbox again.");
    robotConnected = false;
    return;
  }
  const recentPoll = isRobotNetworkConnected(network);

  if (recentPoll !== robotConnected && recentPoll) {
    logWithTimestamp("Robot network found.");
    const res = await downloadLogs(`${network}.2`);
    if (!res) return;
  }

  if (recentPoll !== robotConnected && !recentPoll) {
    logWithTimestamp("Robot network lost.");
  }

  if (kLogFolderId) {
    updateDrive(kLogFolderId).catch((err) => logWithTimestamp(`Could not update drive: ${err}`));
  }

  robotConnected = recentPoll;
  fs.writeFileSync(kLogsJson, JSON.stringify(logs));
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
    });
  } catch (err) {
    logWithTimestamp(`Could not connect to robot: ${err}`);
    return false;
  }

  const foundOnRio: typeof rioLogs = [];

  try {
    const sftp = await ssh.requestSFTP();

    const readdirAsync = (dir: string) =>
      new Promise<string[]>((resolve, reject) =>
        // Typed here: @types/ssh2 would bring an old @types/node into the whole workspace.
        sftp.readdir(dir, (err: Error | undefined, list: { filename: string }[]) =>
          err ? reject(err) : resolve(list.map((i) => i.filename)),
        ),
      );

    for (const origin of kRioLogDirs) {
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
            inDrive: false,
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

        logWithTimestamp(`Found log: ${log.name}`);

        foundOnRio.push({ id: log.id, name: log.name, filename, origin });

        if (!logs.some((l) => l.id === log.id && l.status.downloaded)) {
          downloadingIds.push(log.id);
          try {
            const localPath = localPathOf(log);
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            await ssh.getFile(localPath, log.locations.rio.path);
            logs.push(log);
          } catch (err) {
            logWithTimestamp(`Could not download log file: ${log.id}`);
          } finally {
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

  rioLogs = foundOnRio;
  rioLogsCheckedAt = Date.now();

  return true;
}

async function updateDrive(logFolderId: string) {
  if (driveUpdating) return;
  if (!logs.some((l) => l.status.inDrive === false)) return;

  if (!(await isOnline())) {
    logWithTimestamp("Computer must be online to upload to drive.");
    return;
  }

  driveUpdating = true;
  try {
    const drive = google.drive({ version: "v3", auth });

    const folderData =
      (
        await drive.files.list({
          q: `'${logFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        })
      ).data.files ?? [];
    const folders = folderData.map((f) => ({ name: f.name, id: f.id }));

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      if (!log.status.downloaded || log.status.inDrive) continue;

      let folderId = folders.find((f) => f.name === log.match.event)?.id;

      if (!folderId) {
        const file = await drive.files.create({
          supportsAllDrives: true,
          requestBody: {
            name: log.match.event,
            mimeType: "application/vnd.google-apps.folder",
            parents: [logFolderId],
          },
          fields: "id, name",
        });
        folderId = file.data.id;
        if (folderId) folders.push({ name: log.match.event, id: folderId });
      }

      if (!folderId) {
        logWithTimestamp(`Could not find or create event folder: ${log.match.event}`);
        continue;
      }

      uploadingId = log.id;
      const fileId = await uploadFile(
        drive,
        localPathOf(log),
        `${log.name}.wpilog`,
        folderId,
      ).catch(() => logWithTimestamp(`Could not upload log: ${log.id}`));
      uploadingId = null;

      if (!fileId) continue;

      logs[i].locations.drive = {
        fileId,
        folderId,
      };
      logs[i].status.inDrive = true;
      logWithTimestamp(`Uploaded ${logs[i].name} to the drive.`);
    }
  } finally {
    driveUpdating = false;
    uploadingId = null;
  }
}

async function uploadFile(
  drive: drive_v3.Drive,
  filePath: string,
  fileName: string,
  folderId: string,
) {
  const currentFiles = (
    await drive.files.list({
      q: `'${folderId}' in parents and name = '${fileName}' and trashed = false`,
      fields: "files(id, name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
  ).data.files;

  if (currentFiles && currentFiles.length > 0) {
    return currentFiles[0].id;
  }

  const response = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType: "application/octet-stream",
      body: fs.createReadStream(filePath),
    },
    fields: "id, name",
    uploadType: "resumable",
  });

  return response.data.id;
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

  const decorated = logs.map((log): LogStatus => {
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
      inDrive: log.status.inDrive,
      onRobot: rioLogs.some((r) => r.id === log.id),
      downloading: downloadingIds.includes(log.id),
      uploading: uploadingId === log.id,
      localPath,
      localFile: path.basename(localPath),
      rioPath: log.locations.rio.path,
      sizeBytes,
      driveUrl: log.locations.drive
        ? `https://drive.google.com/file/d/${log.locations.drive.fileId}/view`
        : null,
    };
  });

  const status: Status = {
    version: kVersion,
    restartCommand: kRestartCommand,
    gearbox: gearboxStatus(),
    connection: {
      robot: robotConnected,
      internet: internetConnected,
      driveUpdating,
      uploadingId,
      downloadingIds,
      rioLogsCheckedAt,
    },
    settings: {
      teamNumber: currentPairing()?.teamNumber ?? null,
      robotNetwork: robotNetwork(),
      rioIp: robotNetwork() && `${robotNetwork()}.2`,
      driveFolderUrl: kLogFolderId
        ? `https://drive.google.com/drive/folders/${kLogFolderId}`
        : null,
      rioLogDirs: kRioLogDirs,
      localLogsDir: kLogsDir,
    },
    counts: {
      downloaded: decorated.filter((l) => l.downloaded).length,
      inDrive: decorated.filter((l) => l.inDrive).length,
      pendingUpload: kLogFolderId ? decorated.filter((l) => l.downloaded && !l.inDrive).length : 0,
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
  try {
    await pairWithGearbox(teamNumber, code, name);
    logWithTimestamp(`Paired with team ${teamNumber}'s Pit.`);
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
