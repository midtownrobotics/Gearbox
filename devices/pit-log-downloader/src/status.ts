// What GET /api/status answers: everything the status page shows. Types only, so the page
// (web/) imports them without any of the server's code.

export type MatchTypeName = "Elimination" | "Qualification" | "Practice";

export type LogStatus = {
  id: string;
  /** "Qual-13" */
  name: string;
  event: string;
  matchType: MatchTypeName;
  matchNumber: number;
  downloaded: boolean;
  /** Uploaded to the team's Pit (it isn't uploaded again, even if it's deleted there). */
  uploaded: boolean;
  /** In the team's Pit now, as of Pit's list (asked once a minute); null when that isn't known. */
  inGearbox: boolean | null;
  /** Kept to part of the match when uploaded. */
  trimmed: boolean;
  /** What it comes to gzipped for Pit, once worked out. */
  uploadSize: number | null;
  /** Over Pit's limit gzipped: it waits until it's trimmed. */
  needsTrim: boolean;
  onRobot: boolean;
  downloading: boolean;
  uploading: boolean;
  /** Where it is on this computer. */
  localPath: string;
  /** Its file name there, for /api/download. */
  localFile: string;
  rioPath: string;
  /** Null when the file is gone from this computer. */
  sizeBytes: number | null;
};

/** Pairing with the team's Pit on Gearbox (src/gearbox.ts). */
export type GearboxStatus = {
  /**
   * The Pit it's set to pair with when that isn't the team's usual address (PIT_URL, or the dev
   * gateway's "http://<team>-pit.gearbox.localhost:8796" with --dev); null for the usual one.
   */
  pitUrl: string | null;
  /** The Pit it pairs with unless an address is typed, with "<team>" for the team number. */
  usualPitUrl: string;
  /**
   * Null until it's paired: then the downloader does nothing but ask to be. `usual` when it's the
   * team's usual Pit on Gearbox.
   */
  paired: {
    teamNumber: number;
    pitUrl: string;
    usual: boolean;
    name: string;
    pairedAt: number;
  } | null;
  /**
   * The last check of its key: "ok", "unreachable" (no internet, or Gearbox didn't answer),
   * "removed" (Pit no longer knows it, so it unpaired), or null before any check.
   */
  connection: "ok" | "unreachable" | "removed" | null;
  checkedAt: number | null;
  /** The name it pairs under unless one is given: this computer's. */
  defaultName: string;
};

export type Status = {
  version: string;
  /**
   * How to start it again from a terminal, for when the page loses it: a cd to this Gearbox
   * folder, then the start command.
   */
  restartCommand: string;
  gearbox: GearboxStatus;
  connection: {
    /** On the robot's network. */
    robot: boolean;
    /** Whether the roboRIO answered the last time it was tried; null before (or off its network). */
    rioReachable: boolean | null;
    internet: boolean;
    /** Uploading to Gearbox right now. */
    uploadingRunning: boolean;
    /** Pit has the most logs it keeps and keeps what it has: uploads wait. */
    pitFull: boolean;
    uploadingId: string | null;
    downloadingIds: string[];
    /** When the roboRIO's logs were last listed, or null if they haven't been. */
    rioLogsCheckedAt: number | null;
  };
  settings: {
    /** The paired team's, or null before pairing. */
    teamNumber: number | null;
    /** "10.16.48" */
    robotNetwork: string | null;
    rioIp: string | null;
    /** Null when logs stay on this computer. */
    rioLogDirs: string[];
    localLogsDir: string;
  };
  counts: {
    downloaded: number;
    uploaded: number;
    /** Over Pit's limit, waiting to be trimmed. */
    needsTrim: number;
    pendingUpload: number;
    onRobot: number;
  };
  rioLogs: { id: string; name: string; filename: string; origin: string; downloaded: boolean }[];
  logs: LogStatus[];
  /** Newest first. */
  activity: { id: number; time: string; message: string }[];
};

/** GET /api/logs/:id/trim: what's in a log over time, for choosing what to keep. */
export type TrimView = {
  /** Seconds from its first record to its last. */
  duration: number;
  /** The log's bytes in each second. */
  bytesPerSecond: number[];
  /** When the robot was enabled, and in autonomous, [from, to] in seconds. */
  enabled: [number, number][];
  autonomous: [number, number][];
  /** Around the enabled time, or null if the robot was never enabled. */
  suggested: [number, number] | null;
  /** What it's kept to now, in seconds, or null for all of it. */
  trim: [number, number] | null;
  /** The whole log's bytes, and what it comes to gzipped (trimmed, if it is). */
  rawSize: number;
  uploadSize: number | null;
  /** The most Pit takes, gzipped. */
  maxUploadSize: number;
};
