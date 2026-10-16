import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import express from "express";
import { type drive_v3, google } from "googleapis";
import isOnline from "is-online";
import { NodeSSH } from "node-ssh";
import { config } from "./config.ts";
import { dashboardHtml } from "./dashboard.ts";

const kRobotNetworkBaseIp = config.robotNetworkBaseIp;
const kRioIp = config.rioIp;
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
let rioLogs: { id: string; name: string; filename: string; origin: string }[] = [];
let rioLogsCheckedAt: number | null = null;
let downloadingIds: string[] = [];
let uploadingId: string | null = null;
const activity: { time: string; message: string }[] = [];
const kStartedAt = Date.now();

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

logWithTimestamp(`Started for team ${config.teamNumber}. Logs are kept in ${kLogsDir}.`);
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
  const recentPoll = isRobotNetworkConnected();

  // Internet checks hit the network, so they run on a slower cadence than the poll.
  if (Date.now() - lastInternetCheck > 15000) {
    lastInternetCheck = Date.now();
    internetConnected = await isOnline().catch(() => false);
  }

  if (recentPoll !== robotConnected && recentPoll) {
    logWithTimestamp("Robot network found.");
    const res = await downloadLogs();
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

function isRobotNetworkConnected() {
  return Object.values(os.networkInterfaces())
    .flat()
    .some((n) => n?.address.startsWith(`${kRobotNetworkBaseIp}.`));
}

async function downloadLogs() {
  try {
    await ssh.connect({
      host: kRioIp,
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
        sftp.readdir(dir, (err, list) =>
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

  activity.unshift({ time, message });
  if (activity.length > 100) activity.length = 100;
}

const app = express();

// Serve the dashboard UI
app.get("/", (_req, res) => {
  res.send(dashboardHtml);
});

// Everything the dashboard renders, in one payload.
app.get("/status", (_req, res) => {
  const matchTypeNames: Record<MatchType, string> = {
    e: "Elimination",
    q: "Qualification",
    p: "Practice",
  };

  const decorated = logs.map((log) => {
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

  res.json({
    now: Date.now(),
    startedAt: kStartedAt,
    connection: {
      robot: robotConnected,
      internet: internetConnected,
      driveUpdating,
      uploadingId,
      downloadingIds,
      rioLogsCheckedAt,
    },
    constants: {
      kRobotNetworkBaseIp,
      kRioIp,
      kLogFolderId,
      logFolderUrl: kLogFolderId ? `https://drive.google.com/drive/folders/${kLogFolderId}` : null,
      kServerPort: config.port,
      kLogFileRegex: kLogFileRegex.toString(),
      pollIntervalMs: 3000,
      rioLogDirs: kRioLogDirs,
      localLogsDir: kLogsDir,
    },
    counts: {
      total: decorated.length,
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
  });
});

// List events (folders) or files within an event
app.get("/files", (req, res) => {
  const event = req.query.event as string | undefined;

  if (!fs.existsSync(kLogsDir)) {
    return res.json([]);
  }

  if (!event) {
    // Return top-level event folders
    const entries = fs
      .readdirSync(kLogsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const files = fs.readdirSync(path.join(kLogsDir, e.name));
        return { type: "folder", name: e.name, count: files.length };
      });
    return res.json(entries);
  }

  // Sanitize to prevent path traversal
  const eventDir = path.join(kLogsDir, path.basename(event));
  if (!fs.existsSync(eventDir)) {
    return res.json([]);
  }

  const files = fs
    .readdirSync(eventDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const stat = fs.statSync(path.join(eventDir, e.name));
      const mb = (stat.size / 1024 / 1024).toFixed(1);
      return { type: "file", name: e.name, event, size: `${mb} MB` };
    });

  res.json(files);
});

// Download a specific log file
app.get("/download", (req, res) => {
  const event = req.query.event as string;
  const file = req.query.file as string;

  if (!event || !file) {
    return res.status(400).send("Missing event or file parameter.");
  }

  // Sanitize both segments to prevent path traversal
  const filePath = path.join(kLogsDir, path.basename(event), path.basename(file));

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found.");
  }

  res.download(filePath);
});

app.listen(config.port, config.host, () => {
  const shown = config.host === "0.0.0.0" ? "localhost" : config.host;
  logWithTimestamp(`Log browser running at http://${shown}:${config.port}`);
});
