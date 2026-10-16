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
  inDrive: boolean;
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
  driveUrl: string | null;
};

/** Pairing with the team's Pit on Gearbox (src/gearbox.ts). */
export type GearboxStatus = {
  /**
   * The Pit it's set to pair with when that isn't the team's usual address (PIT_URL, or the dev
   * gateway's "http://<team>-pit.gearbox.localhost:8796" with --dev); null for the usual one.
   */
  pitUrl: string | null;
  /** Null until it's paired: then the downloader does nothing but ask to be. */
  paired: { teamNumber: number; pitUrl: string; name: string; pairedAt: number } | null;
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
    robot: boolean;
    internet: boolean;
    driveUpdating: boolean;
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
    driveFolderUrl: string | null;
    rioLogDirs: string[];
    localLogsDir: string;
  };
  counts: {
    downloaded: number;
    inDrive: number;
    pendingUpload: number;
    onRobot: number;
  };
  rioLogs: { id: string; name: string; filename: string; origin: string; downloaded: boolean }[];
  logs: LogStatus[];
  /** Newest first. */
  activity: { id: number; time: string; message: string }[];
};
