// Test users for worker tests. Workers check sign-in by asking G3ID's /auth/me about the request's
// cookie; in tests, G3ID is a stub (config.ts) that reads the user straight out of a test cookie
// made here. Used both by the stub (in Node) and by tests (in the Workers runtime), so it only
// uses what both have.

import { teamKey } from "@g3/site-config";

/** The site's team (site.ts); test users are in it unless made with `teamUsers`. */
export const SITE_TEAM = teamKey;

export type TestUser = {
  id: string;
  /** Their team's id ("frc<number>"); the site's team unless made with `teamUsers`. */
  teamId: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
  isMentor: boolean;
  /** "pin" is a kiosk PIN session: G3ID never reports admin or mentor for one. */
  sessionType: "oauth" | "pin";
  kioskDeviceId?: number;
  kioskDeviceName?: string;
  identities: { provider: string; providerId: string }[];
};

export function testUser(overrides: Partial<TestUser> & { id: string }): TestUser {
  return {
    teamId: SITE_TEAM,
    displayName: overrides.id,
    email: `${overrides.id}@test.g3`,
    isAdmin: false,
    isMentor: false,
    sessionType: "oauth",
    identities: [],
    ...overrides,
  };
}

/** A student: signed in, no roles. */
export const student = testUser({ id: "student-1", displayName: "Sam Student" });
/** Another student, for "only your own" checks. */
export const otherStudent = testUser({ id: "student-2", displayName: "Olive Other" });
export const mentor = testUser({ id: "mentor-1", displayName: "Morgan Mentor", isMentor: true });
export const admin = testUser({ id: "admin-1", displayName: "Ada Admin", isAdmin: true });
/** An admin signed in with a PIN on a shop kiosk: G3ID reports no roles for this session. */
export const kioskAdmin = testUser({
  id: "admin-1",
  displayName: "Ada Admin",
  isAdmin: true,
  sessionType: "pin",
  kioskDeviceId: 1,
  kioskDeviceName: "Test Kiosk",
});

/**
 * The standard users in another team: the same people, with ids of their own (so a leak between
 * teams shows up), for isolation tests. The site's team gets the plain exported users.
 */
export function teamUsers(teamId: string) {
  const inTeam = (user: TestUser): TestUser =>
    teamId === SITE_TEAM ? user : { ...user, id: `${user.id}.${teamId}`, teamId };
  return {
    teamId,
    student: inTeam(student),
    otherStudent: inTeam(otherStudent),
    mentor: inTeam(mentor),
    admin: inTeam(admin),
    kioskAdmin: inTeam(kioskAdmin),
  };
}

export type TeamUsers = ReturnType<typeof teamUsers>;

/** A team id no other test has used (an "frc" number past any real one). */
export const newTeamId = () =>
  `frc${100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000)}`;

const PREFIX = "test.";

/** The `Cookie` header that signs a request in as this user (the G3ID stub reads it). */
export function cookieFor(user: TestUser): string {
  const json = JSON.stringify(user);
  const base64 = btoa(
    Array.from(new TextEncoder().encode(json), (b) => String.fromCharCode(b)).join(""),
  );
  return `g3_session=${PREFIX}${base64}`;
}

/** The user a test cookie names, or null for none or a malformed one. */
export function userFromCookie(cookieHeader: string): TestUser | null {
  const value = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`g3_session=${PREFIX}`))
    ?.slice(`g3_session=${PREFIX}`.length);
  if (!value) return null;
  try {
    const bytes = Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as TestUser;
  } catch {
    return null;
  }
}

/** Request options signed in as `user`, merged with `init` (JSON bodies are serialized). */
export function asUser(
  user: TestUser,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookieFor(user));
  // As the gateway sends it: the request is on the user's own team's address.
  if (!headers.has("X-Team-Id")) headers.set("X-Team-Id", user.teamId);
  let body = init.body as BodyInit | undefined;
  if (
    init.body !== undefined &&
    typeof init.body !== "string" &&
    !(init.body instanceof FormData)
  ) {
    body = JSON.stringify(init.body);
    headers.set("Content-Type", "application/json");
  }
  return { ...init, headers, body };
}
