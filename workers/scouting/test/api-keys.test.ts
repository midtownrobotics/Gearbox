import { env } from "cloudflare:workers";
import { withTeam } from "@g3/auth";
import { teamKey } from "@g3/site-config";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { teamApiKey } from "../src/api-keys";
import { createDb } from "../src/db";
import { strategyEventConfig } from "../src/db/schema";
import type { AppEnv } from "../src/types";

const db = createDb((env as unknown as AppEnv["Bindings"]).SCOUTING_DB);

describe("Scouting API key isolation", () => {
  it("uses saved team keys and reserves legacy deployment keys for their original owner", () => {
    expect(teamApiKey(newTeamId(), "team-a-key", "legacy-key")).toBe("team-a-key");
    expect(teamApiKey(newTeamId(), "team-b-key", "legacy-key")).toBe("team-b-key");
    expect(teamApiKey(newTeamId(), null, "legacy-key")).toBe("");
    expect(teamApiKey(teamKey, null, "legacy-key")).toBe("legacy-key");
    expect(teamApiKey(teamKey, "saved-key", "legacy-key")).toBe("saved-key");
  });

  it("does not report another team's keys or the global keys as configured", async () => {
    const a = teamUsers(newTeamId());
    const b = teamUsers(newTeamId());
    for (const team of [a, b])
      await db.insert(strategyEventConfig).values(
        withTeam(team.teamId, {
          id: 1,
          event_key: team === a ? "" : `2099qakey${crypto.randomUUID().slice(0, 8)}`,
          tba_auth_key: team === a ? "team-a-tba-secret" : null,
          nexus_api_key: team === a ? "team-a-nexus-secret" : null,
          updated_by: team.admin.id,
          updated_at: Date.now(),
        }),
      );
    const first = await jsonAs(a.admin, "/scouting/event-context");
    const second = await jsonAs(b.admin, "/scouting/event-context");
    expect(first).toMatchObject({
      hasTbaAuthKey: true,
      hasNexusApiKey: true,
      tbaAuthKey: "",
      nexusApiKey: "",
    });
    expect(second).toMatchObject({
      hasTbaAuthKey: false,
      hasNexusApiKey: false,
      scheduleError: "TBA authentication key is not configured.",
      tbaAuthKey: "",
      nexusApiKey: "",
    });
    expect(JSON.stringify(first)).not.toContain("secret");
    expect(JSON.stringify(second)).not.toContain("secret");
    expect(await jsonAs(b.admin, "/team-settings")).toMatchObject({
      integrations: { "the blue alliance": { connected: false } },
    });
  });

  it("refuses to validate a new team's event using a configured deployment key", async () => {
    const team = teamUsers(newTeamId());
    const response = await callAs(team.admin, "/scouting/event-context", {
      method: "PUT",
      body: { eventKey: "2099qakeyisolation", currentMatchNumber: 1 },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "TBA authentication key is not configured." });
  });
});
