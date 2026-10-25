import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { coreUserIdentities } from "../src/db/schema";
import { newId } from "../src/lib/id";
import { createTeam, createUser, createUserWithPin, g3id, sessionCookie, testEnv } from "./helpers";

// A member's page in G3ID's Users list (GET /admin/users/:id), and the list's sign-in account
// names that its search looks through.

describe("a member's details", () => {
  it("show their sign-ins and whether they have a kiosk PIN, never the PIN or tokens", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const { id } = await createUserWithPin({ displayName: "Pat Doe" });
    const now = Math.floor(Date.now() / 1000);
    await createDb(testEnv.DB).insert(coreUserIdentities).values({
      id: newId(),
      userId: id,
      provider: "github",
      providerId: newId(),
      providerEmail: "patdoe",
      accessToken: "secret-token",
      createdAt: now,
      updatedAt: now,
    });

    const res = await g3id(`/admin/users/${id}`, { cookie: admin });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("secret-token");
    const details = JSON.parse(text) as Record<string, unknown>;
    expect(details).toMatchObject({
      id,
      displayName: "Pat Doe",
      identities: [{ provider: "github", providerEmail: "patdoe" }],
    });
    expect(details.kioskPinSince).toEqual(expect.any(Number));
    expect(details).not.toHaveProperty("pin");

    const list = (await (await g3id("/admin/users", { cookie: admin })).json()) as {
      id: string;
      identities: { providerEmail: string | null }[];
    }[];
    expect(list.find((u) => u.id === id)?.identities[0].providerEmail).toBe("patdoe");
  });

  it("are for admins only", async () => {
    const member = await sessionCookie(await createUser());
    const other = await createUser();
    expect((await g3id(`/admin/users/${other}`, { cookie: member })).status).toBe(403);
  });
});

describe("a member's name", () => {
  const rename = (id: string, cookie: string, name: unknown) =>
    g3id(`/admin/users/${id}/name`, { method: "PUT", cookie, body: { name } });

  it("can be changed by an admin, leaving their username as it is", async () => {
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const id = await createUser({ displayName: "robo_kid", username: "robo_kid" });
    const res = await rename(id, admin, "  Sam   Rivera ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ displayName: "Sam Rivera" });
    const details = (await (await g3id(`/admin/users/${id}`, { cookie: admin })).json()) as {
      displayName: string;
      username: string;
    };
    expect(details).toMatchObject({ displayName: "Sam Rivera", username: "robo_kid" });

    expect((await rename(id, admin, "   ")).status).toBe(400);
    expect((await rename(id, admin, "x".repeat(81))).status).toBe(400);
  });

  it("is changed only by the member's own team's admins", async () => {
    const id = await createUser({ displayName: "Kept" });
    const member = await sessionCookie(await createUser());
    expect((await rename(id, member, "Changed")).status).toBe(403);
    const otherAdmin = await sessionCookie(
      await createUser({ teamId: await createTeam(), isAdmin: true }),
    );
    expect((await rename(id, otherAdmin, "Changed")).status).toBe(404);
    const admin = await sessionCookie(await createUser({ isAdmin: true }));
    const details = (await (await g3id(`/admin/users/${id}`, { cookie: admin })).json()) as {
      displayName: string;
    };
    expect(details.displayName).toBe("Kept");
  });
});
