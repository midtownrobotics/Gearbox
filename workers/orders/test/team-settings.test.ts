import { env } from "cloudflare:test";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// The team's dashboard reads and saves Orders' settings through /team-settings (teamSettingsRoutes
// in @g3/auth): the same settings as the Settings page, by manifest key.

type State = {
  values: Record<string, unknown>;
  integrations: Record<string, { connected: boolean }>;
  canEdit: string[];
};

const put = (values: Record<string, unknown>) => ({ method: "PUT", body: { values } });

describe("Orders' team settings", () => {
  it("are read by mentors and admins with the team's values and defaults", async () => {
    const team = teamUsers(newTeamId());
    const state = await jsonAs<State>(team.mentor, "/team-settings");
    expect(state.values).toEqual({
      currency: "USD",
      fiscalYearStart: 7,
      namingTemplate: "{vendor} {sku} – {title}",
      inventoryRequired: false,
    });
    expect(state.integrations["share-a-cart"]).toEqual({ connected: false });
    expect(state.canEdit).toContain("currency");
    expect((await callAs(team.student, "/team-settings")).status).toBe(403);
    expect((await callAs(team.kioskAdmin, "/team-settings")).status).toBe(403);
  });

  it("saves what changed, as the Settings page would, and logs it", async () => {
    const team = teamUsers(newTeamId());
    const saved = await jsonAs<State>(
      team.admin,
      "/team-settings",
      put({ currency: "cad", fiscalYearStart: 1, inventoryRequired: false }),
    );
    expect(saved.values).toMatchObject({ currency: "CAD", fiscalYearStart: 1 });
    expect(await jsonAs(team.student, "/me")).toMatchObject({
      currency: "CAD",
      fiscalYearStart: 1,
    });
    const g3id = (env as unknown as { G3ID: Fetcher }).G3ID;
    const log = (await (
      await g3id.fetch(`http://g3id/api/internal/teams/${team.teamId}/audit`)
    ).json()) as unknown[];
    expect(log).toEqual([
      {
        userId: team.admin.id,
        app: "orders",
        what: "Orders settings",
        changed: ["Currency", "Fiscal year starts"],
      },
    ]);
  });

  it("refuses values that don't fit the setting, and students", async () => {
    const team = teamUsers(newTeamId());
    for (const values of [
      { fiscalYearStart: 13 },
      { currency: "dollars" },
      { namingTemplate: "{vendor}" },
      { inventoryRequired: "yes" },
      { nope: 1 },
    ]) {
      expect((await callAs(team.mentor, "/team-settings", put(values))).status).toBe(400);
    }
    expect((await callAs(team.student, "/team-settings", put({ currency: "EUR" }))).status).toBe(
      403,
    );
    expect(await jsonAs(team.student, "/me")).toMatchObject({ currency: "USD" });
  });
});
