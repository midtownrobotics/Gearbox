// Pairing with the team's Pit on Gearbox. A mentor or admin gets a 6-digit code on Pit's Logs
// page; the status page sends it here, and Pit answers with this downloader's own key, which is
// kept in DATA_DIR/gearbox.json (readable only by this computer's user) and sent as
// `Authorization: Bearer <key>` to Pit's /api/downloader/* routes.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config } from "./config.ts";
import type { GearboxStatus } from "./status.ts";

type Pairing = {
  /** The Pit it's paired with: a new PIT_URL means pairing again. */
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
    return saved.pitUrl === config.pitUrl && saved.key ? saved : null;
  } catch {
    return null;
  }
}

function save(next: Pairing | null) {
  pairing = next;
  if (next) fs.writeFileSync(kPairingFile, JSON.stringify(next, null, 2), { mode: 0o600 });
  else fs.rmSync(kPairingFile, { force: true });
}

/** A request to the team's Pit API, with this downloader's key when it has one. */
function pit(apiPath: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (pairing) headers.set("Authorization", `Bearer ${pairing.key}`);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${config.pitUrl}/api${apiPath}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(kTimeoutMs),
  });
}

/** The name it pairs under unless one is given: this computer's. */
export const defaultName = () => os.hostname().slice(0, 60) || "Pit computer";

export function gearboxStatus(): GearboxStatus {
  return {
    pitUrl: config.pitUrl,
    paired: pairing ? { name: pairing.name, pairedAt: pairing.pairedAt } : null,
    connection,
    checkedAt,
    defaultName: defaultName(),
  };
}

/** Asks Pit whether the key still works. Pit having removed it unpairs this side too. */
export async function checkGearbox(): Promise<void> {
  if (!pairing) {
    connection = null;
    return;
  }
  try {
    const res = await pit("/downloader/me");
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

export async function pairWithGearbox(code: string, name: string): Promise<void> {
  let res: Response;
  try {
    res = await pit("/downloaders/pair", {
      method: "POST",
      body: JSON.stringify({ code, name: name.trim() || defaultName() }),
    });
  } catch {
    throw new PairingError(`Couldn't reach Gearbox at ${config.pitUrl}. Check the internet.`);
  }
  const body = (await res.json().catch(() => null)) as {
    id?: number;
    name?: string;
    key?: string;
    error?: string;
  } | null;
  if (!res.ok || !body?.key || typeof body.id !== "number") {
    throw new PairingError(body?.error ?? `Gearbox answered ${res.status}.`);
  }
  save({
    pitUrl: config.pitUrl,
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
  if (pairing) await pit("/downloader/me", { method: "DELETE" }).catch(() => null);
  save(null);
  connection = null;
  checkedAt = null;
}
