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

export type Status = {
  version: string;
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
    teamNumber: number;
    /** "10.16.48" */
    robotNetwork: string;
    rioIp: string;
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
