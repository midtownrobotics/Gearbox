// SPDX-License-Identifier: AGPL-3.0-only
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { site } from "@g3/site-config";
import { type TestUser, asUser, teamUsers } from "@g3/testing/users";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/types";

// The terms a team's owner accepted (terms section 21): the home page asks the owner to accept the
// current ones after a material change, and nobody else.

const testEnv = env as unknown as AppEnv["Bindings"];

/** A new active team owned by `owner` (one of its users), with the terms it accepted. */
async function newTeam(version: string | null, owner: keyof ReturnType<typeof teamUsers>) {
  const number = 20000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 70000);
  const users = teamUsers(`frc${number}`);
  const ownerId = (users[owner] as TestUser).id;
  await testEnv.PLATFORM_DB.prepare(
    `INSERT INTO teams (id, team_number, name, country, status, owner_user_id, terms_version,
       created_at, updated_at)
     VALUES (?1, ?2, 'A Team', 'US', 'active', ?3, ?4, 1, 1)`,
  )
    .bind(users.teamId, number, ownerId, version)
    .run();
  return users;
}

function call(user: TestUser, path: string, init: { method?: string; body?: unknown } = {}) {
  return exports.default.fetch(new Request(`http://platform/api${path}`, asUser(user, init)));
}

const termsFor = async (user: TestUser) =>
  (await (await call(user, "/team/terms")).json()) as {
    version: string;
    accepted: string | null;
    isOwner: boolean;
    mustAccept: boolean;
  };

const accepted = async (teamId: string) =>
  (
    await testEnv.PLATFORM_DB.prepare("SELECT terms_version FROM teams WHERE id = ?")
      .bind(teamId)
      .first<{ terms_version: string | null }>()
  )?.terms_version;

describe("accepting the terms", () => {
  it("asks the owner of a team that accepted none, or older ones, and no one else", async () => {
    const team = await newTeam(null, "admin");
    expect(await termsFor(team.admin)).toEqual({
      version: site.legal.termsVersion,
      accepted: null,
      isOwner: true,
      mustAccept: true,
    });
    expect((await termsFor(team.mentor)).mustAccept).toBe(false);

    const old = await newTeam("2000-01-01", "admin");
    expect((await termsFor(old.admin)).mustAccept).toBe(true);
  });

  it("doesn't ask an owner who accepted the current terms", async () => {
    const team = await newTeam(site.legal.termsVersion, "admin");
    expect((await termsFor(team.admin)).mustAccept).toBe(false);
  });

  it("records the owner's acceptance of the version they were shown", async () => {
    const team = await newTeam(null, "admin");
    const stale = await call(team.admin, "/team/terms/accept", {
      method: "POST",
      body: { version: "2000-01-01" },
    });
    expect(stale.status).toBe(409);
    expect(await accepted(team.teamId)).toBeNull();

    const res = await call(team.admin, "/team/terms/accept", {
      method: "POST",
      body: { version: site.legal.termsVersion },
    });
    expect(res.status).toBe(200);
    expect(await accepted(team.teamId)).toBe(site.legal.termsVersion);
    expect((await termsFor(team.admin)).mustAccept).toBe(false);
  });

  it("only takes it from the owner, never from a kiosk", async () => {
    const team = await newTeam(null, "kioskAdmin");
    const body = { version: site.legal.termsVersion };
    for (const user of [team.mentor, team.kioskAdmin]) {
      const res = await call(user, "/team/terms/accept", { method: "POST", body });
      expect(res.status).toBe(403);
    }
    expect((await termsFor(team.kioskAdmin)).mustAccept).toBe(false);
    expect(await accepted(team.teamId)).toBeNull();
  });
});
