// Pairing with the team's Pit on Gearbox, which the downloader needs before it does anything: it
// gives the downloader its team. On Pit's Logs page a mentor or admin gets a 6-digit code; the
// status page sends it here with the team number, and the team's Pit answers with this
// downloader's own key, which is kept in DATA_DIR/gearbox.json (readable only by this computer's
// user) and sent as `Authorization: Bearer <key>` to Pit's /api/downloader/* routes.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config, pitUrlFor } from "./config.ts";
import type { GearboxStatus } from "./status.ts";

export type Pairing = {
  teamNumber: number;
  /** The Pit it paired with. */
  pitUrl: string;
  id: number;
  name: string;
  key: string;
  pairedAt: number;
};

const kPairingFile = path.join(config.dataDir, "gearbox.json");
const kTimeoutMs = 10_000;

let pairing: Pairing | null = load();
let connection: GearboxStatus["connection"] = null;
let checkedAt: number | null = null;

function load(): Pairing | null {
  try {
    const saved = JSON.parse(fs.readFileSync(kPairingFile, "utf8")) as Pairing;
    // Paired with another Pit than the one it's now set to use (PIT_URL, --dev): pair again.
    if (!saved.key || !saved.teamNumber || saved.pitUrl !== pitUrlFor(saved.teamNumber)) {
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function save(next: Pairing | null) {
  pairing = next;
  if (next) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(kPairingFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  } else {
    fs.rmSync(kPairingFile, { force: true });
  }
}

/** The pairing, while there is one: the downloader does nothing without it. */
export const currentPairing = () => pairing;

/** A request to a team's Pit API, with this downloader's key when it has one. */
function pit(teamNumber: number, apiPath: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (pairing) headers.set("Authorization", `Bearer ${pairing.key}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${pitUrlFor(teamNumber)}/api${apiPath}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(kTimeoutMs),
  });
}

/** The name it pairs under unless one is given: this computer's. */
export const defaultName = () => os.hostname().slice(0, 60) || "Pit computer";

export function gearboxStatus(): GearboxStatus {
  return {
    paired: pairing
      ? {
          teamNumber: pairing.teamNumber,
          pitUrl: pairing.pitUrl,
          name: pairing.name,
          pairedAt: pairing.pairedAt,
        }
      : null,
    // Shown on the pairing screen when it isn't the team's usual Pit on Gearbox.
    pitUrl: config.pitUrl ?? (config.devGateway ? pitUrlFor("<team>") : null),
    connection,
    checkedAt,
    defaultName: defaultName(),
  };
}

/** Asks Pit whether the key still works. Pit having removed it unpairs this side too. */
export async function checkGearbox(): Promise<void> {
  if (!pairing) return;
  try {
    const res = await pit(pairing.teamNumber, "/downloader/me");
    checkedAt = Date.now();
    if (res.status === 401) {
      save(null);
      connection = "removed";
    } else {
      connection = res.ok ? "ok" : "unreachable";
    }
  } catch {
    checkedAt = Date.now();
    connection = "unreachable";
  }
}

export class PairingError extends Error {}

export async function pairWithGearbox(teamNumber: number, code: string, name: string) {
  const pitUrl = pitUrlFor(teamNumber);
  let res: Response;
  try {
    res = await pit(teamNumber, "/downloaders/pair", {
      method: "POST",
      body: JSON.stringify({ code, name: name.trim() || defaultName() }),
    });
  } catch {
    throw new PairingError(`Couldn't reach Gearbox at ${pitUrl}. Check the internet connection.`);
  }
  const body = (await res.json().catch(() => null)) as {
    id?: number;
    name?: string;
    key?: string;
    error?: string;
  } | null;
  if (res.status === 404) {
    throw new PairingError(`Gearbox has no Pit for team ${teamNumber}. Check the team number.`);
  }
  if (!res.ok || !body?.key || typeof body.id !== "number") {
    throw new PairingError(body?.error ?? `Gearbox answered ${res.status}.`);
  }
  save({
    teamNumber,
    pitUrl,
    id: body.id,
    name: body.name ?? name,
    key: body.key,
    pairedAt: Date.now(),
  });
  connection = "ok";
  checkedAt = Date.now();
}

/** Forgets the pairing, and tells Pit to remove this downloader when it can. */
export async function unpairFromGearbox(): Promise<void> {
  if (pairing)
    await pit(pairing.teamNumber, "/downloader/me", { method: "DELETE" }).catch(() => null);
  save(null);
  connection = null;
  checkedAt = null;
}
