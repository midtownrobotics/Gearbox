import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { createDb } from "../src/db";
import { coreUserIdentities, coreUsers } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { hashPassword } from "../src/lib/password";
import { generatePinForUser, generateUniquePin } from "../src/lib/pin";
import { createSession } from "../src/lib/session";
import { currentTeamId } from "../src/lib/team";
import type { AppEnv } from "../src/types";

// G3ID's tests run the real worker against its own D1 and KV. These seed users straight into the
// database and make sessions the way sign-in does, so each test sets up only what it needs.

export const testEnv = env as unknown as AppEnv["Bindings"];

/** A request to G3ID. JSON bodies are serialized; `cookie` signs it in. */
export function g3id(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown; cookie?: string; kioskToken?: string } = {},
) {
  const { body, cookie, kioskToken, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (cookie) headers.set("Cookie", cookie);
  if (kioskToken) headers.set("X-Kiosk-Token", kioskToken);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(
    new Request(`http://g3id${path}`, {
      ...rest,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

type NewUser = {
  email?: string;
  displayName?: string;
  /** Sets up email/password sign-in. */
  password?: string;
  status?: "active" | "pending" | "rejected";
  isAdmin?: boolean;
  isMentor?: boolean;
  /** The user's team; G3's (the team in site.ts) by default. */
  teamId?: string;
};

export async function createUser(user: NewUser = {}): Promise<string> {
  const db = createDb(testEnv.DB);
  const id = newId();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(coreUsers).values({
    id,
    teamId: user.teamId ?? currentTeamId(),
    email: user.email ?? `${id}@test.g3`,
    displayName: user.displayName ?? "Test User",
    status: user.status ?? "active",
    isAdmin: user.isAdmin ? 1 : 0,
    isMentor: user.isMentor ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });
  if (user.password) {
    await db.insert(coreUserIdentities).values({
      id: newId(),
      userId: id,
      provider: "local",
      passwordHash: await hashPassword(user.password),
      createdAt: now,
      updatedAt: now,
    });
  }
  return id;
}

/** A user with a kiosk PIN. PINs come from G3ID's own generator, so they never collide. */
export async function createUserWithPin(user: NewUser = {}): Promise<{ id: string; pin: string }> {
  const id = await createUser(user);
  return { id, pin: await generatePinForUser(id, testEnv) };
}

/** A PIN nobody in the team has (G3's team by default). */
export const unusedPin = async (teamId?: string) =>
  generateUniquePin(teamId ?? currentTeamId(), testEnv);

/** A second team, for tests that check teams are kept apart. */
export async function createTeam(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const number = 10000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000);
  await testEnv.DB.prepare(
    "INSERT INTO teams (id, team_number, name, created_at, updated_at) VALUES (?, ?, 'Other Team', ?, ?)",
  )
    .bind(`frc${number}`, number, now, now)
    .run();
  return `frc${number}`;
}

/** A signed-in browser session for the user, as its Cookie header. */
export async function sessionCookie(userId: string): Promise<string> {
  return `g3_session=${await createSession(userId, testEnv)}`;
}

/** The g3_session cookie a response set, as a Cookie header (null if none). */
export function cookieFrom(res: Response): string | null {
  const match = (res.headers.get("Set-Cookie") ?? "").match(/g3_session=([^;]*)/);
  return match?.[1] ? `g3_session=${match[1]}` : null;
}

/** An admin signs a new kiosk device in; returns its token. */
export async function activateKiosk(adminCookie: string, name = "Test Kiosk"): Promise<string> {
  const code = await g3id("/admin/kiosk/codes", {
    method: "POST",
    cookie: adminCookie,
    body: { deviceName: name },
  });
  const { code: activationCode } = (await code.json()) as { code: string };
  const res = await g3id("/kiosk/activate", { method: "POST", body: { code: activationCode } });
  return ((await res.json()) as { token: string }).token;
}
