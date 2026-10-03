// Test users for worker tests. Workers check sign-in by asking G3ID's /auth/me about the request's
// cookie; in tests, G3ID is a stub (config.ts) that reads the user straight out of a test cookie
// made here. Used both by the stub (in Node) and by tests (in the Workers runtime), so it only
// uses what both have.

export type TestUser = {
  id: string;
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
