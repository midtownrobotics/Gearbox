// SPDX-License-Identifier: AGPL-3.0-only
import type { createShopDb } from "../db";
import { SETTING, deleteSetting, getSetting, setSetting } from "./settings";

// Why Onshape's events for a team are being dropped, so the banner can say so: until now an admin
// whose signing keys were wrong saw "registered" and then nothing. Kept from the first dropped
// event until one is accepted, or the Onshape settings are saved again.

type ShopDb = ReturnType<typeof createShopDb>;

/**
 * `unsigned`: Onshape sent no signature (no signing keys in the company's settings).
 * `no keys`: signed, but Shop has no signing keys saved. `wrong keys`: signed with other keys.
 */
export type WebhookProblemKind = "unsigned" | "no keys" | "wrong keys";
export type WebhookProblem = { kind: WebhookProblemKind; at: number };

const KINDS: WebhookProblemKind[] = ["unsigned", "no keys", "wrong keys"];

export async function webhookProblem(db: ShopDb, teamId: string): Promise<WebhookProblem | null> {
  const raw = await getSetting(db, teamId, SETTING.onshapeWebhookProblem);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WebhookProblem>;
    if (!parsed.kind || !KINDS.includes(parsed.kind) || typeof parsed.at !== "number") return null;
    return { kind: parsed.kind, at: parsed.at };
  } catch {
    return null;
  }
}

/** Notes a dropped event. A burst of the same problem keeps the first one's time and writes once. */
export async function noteWebhookProblem(db: ShopDb, teamId: string, kind: WebhookProblemKind) {
  const current = await webhookProblem(db, teamId);
  if (current?.kind === kind) return;
  const problem: WebhookProblem = { kind, at: Date.now() };
  await setSetting(db, teamId, SETTING.onshapeWebhookProblem, JSON.stringify(problem));
}

/** An event was accepted, or the settings were saved again: nothing to warn about. */
export async function clearWebhookProblem(db: ShopDb, teamId: string) {
  if (await getSetting(db, teamId, SETTING.onshapeWebhookProblem)) {
    await deleteSetting(db, teamId, SETTING.onshapeWebhookProblem);
  }
}
