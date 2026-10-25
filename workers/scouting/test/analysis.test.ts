import { env } from "cloudflare:workers";
import { inTeam, withTeam } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { manualEvents, scoutingFormSubmissions, strategyEventConfig } from "../src/db/schema";
import type { AppEnv } from "../src/types";

const db = createDb((env as unknown as AppEnv["Bindings"]).SCOUTING_DB);
type Analysis = {
  reports: { id: string; formKind: string; eventKey: string }[];
  eventNames: Record<string, string>;
  currentEventKey: string | null;
};

async function reportsFor(eventKeys: string[], authKey = "test-key") {
  const team = teamUsers(newTeamId());
  const { forms } = await jsonAs<{ forms: { id: string; kind: string }[] }>(
    team.admin,
    "/scouting/scouting-forms",
  );
  await db.insert(strategyEventConfig).values(
    withTeam(team.teamId, {
      id: 1,
      event_key: "",
      tba_auth_key: authKey,
      updated_by: team.admin.id,
      updated_at: Date.now(),
    }),
  );
  for (const [index, eventKey] of eventKeys.entries()) {
    const form = forms.find((form) => form.kind === (index % 2 ? "pit" : "scouting"));
    if (!form) throw new Error("Missing seeded form");
    await db.insert(scoutingFormSubmissions).values(
      withTeam(team.teamId, {
        id: crypto.randomUUID(),
        form_id: form.id,
        answers_json: "{}",
        submitted_by: team.student.id,
        submitted_by_name: team.student.displayName,
        created_at: Date.now(),
        team_name: "123",
        event_key: eventKey,
      }),
    );
  }
  return team;
}

describe("analysis report types and event names", () => {
  it("lets members read their team's reports and drawings while preserving management permissions", async () => {
    const team = await reportsFor(["2099qaoffline"]);
    const other = await reportsFor(["2099qaoffline"]);
    const result = await jsonAs<Analysis>(team.student, "/scouting/analysis");
    expect(result.reports).toHaveLength(1);
    const id = result.reports[0].id;
    const key = `teams/${team.teamId}/scouting-submissions/${id}/path.png`;
    await (env as unknown as AppEnv["Bindings"]).FIELD_MAPS.put(key, "test drawing");
    await db
      .update(scoutingFormSubmissions)
      .set({
        drawing_fields_json: JSON.stringify({ path: { key, contentType: "image/png" } }),
      })
      .where(inTeam(scoutingFormSubmissions, team.teamId))
      .run();
    const drawingPath = `/scouting/scouting-submissions/${id}/drawings/path`;
    const drawing = await callAs(team.student, drawingPath);
    expect(drawing.status).toBe(200);
    expect(new Uint8Array(await drawing.arrayBuffer())).toEqual(
      new TextEncoder().encode("test drawing"),
    );
    expect((await callAs(other.student, drawingPath)).status).toBe(404);
    const otherReports = await jsonAs<Analysis>(other.student, "/scouting/analysis");
    expect(otherReports.reports.map((report) => report.id)).not.toContain(id);
    for (const [method, suffix] of [
      ["PUT", "/stars"],
      ["DELETE", ""],
      ["PUT", "/restore"],
      ["DELETE", "/permanent"],
    ]) {
      expect(
        (await callAs(team.student, `/scouting/analysis/reports/${id}${suffix}`, { method }))
          .status,
      ).toBe(403);
    }
  });

  it("returns match/pit kinds with short event names, falling back to the full name", async () => {
    const team = await reportsFor(["2099qashort", "2099qafull"]);
    const result = await jsonAs<Analysis>(team.admin, "/scouting/analysis");
    expect(result.reports.map((report) => report.formKind).sort()).toEqual(["pit", "scouting"]);
    expect(result.eventNames).toEqual({
      "2099qashort": "Test STING",
      "2099qafull": "Test Championship",
    });
  });

  it("caches public event names and still reads them without a TBA credential", async () => {
    const team = await reportsFor(["2099qacache"]);
    const first = await jsonAs<Analysis>(team.admin, "/scouting/analysis");
    expect(first.eventNames["2099qacache"]).toBe("Cached Test");
    await db
      .update(strategyEventConfig)
      .set({ tba_auth_key: null })
      .where(inTeam(strategyEventConfig, team.teamId))
      .run();
    const cached = await jsonAs<Analysis>(team.admin, "/scouting/analysis");
    expect(cached.eventNames).toEqual(first.eventNames);
  });

  it("keeps identically keyed manual-event names private to their teams", async () => {
    const a = await reportsFor(["manual-shared"]);
    const b = await reportsFor(["manual-shared"]);
    for (const [team, name] of [
      [a, "Private A"],
      [b, "Private B"],
    ] as const) {
      await db.insert(manualEvents).values(
        withTeam(team.teamId, {
          event_key: "manual-shared",
          event_name: name,
          ends_at: Date.now() + 86400000,
          delete_after: Date.now() + 345600000,
          created_by: team.admin.id,
          updated_at: Date.now(),
        }),
      );
    }
    const first = await jsonAs<Analysis>(a.admin, "/scouting/analysis");
    const second = await jsonAs<Analysis>(b.admin, "/scouting/analysis");
    expect(first.eventNames).toEqual({ "manual-shared": "Private A" });
    expect(second.eventNames).toEqual({ "manual-shared": "Private B" });
    expect(second.reports.map((report) => report.id)).not.toContain(first.reports[0].id);
  });

  it("says which event the team is scouting now", async () => {
    const team = await reportsFor(["2099qaoffline"], "");
    expect((await jsonAs<Analysis>(team.student, "/scouting/analysis")).currentEventKey).toBeNull();
    await db
      .update(strategyEventConfig)
      .set({ event_key: "manual-current" })
      .where(inTeam(strategyEventConfig, team.teamId))
      .run();
    const result = await jsonAs<Analysis>(team.student, "/scouting/analysis");
    expect(result.currentEventKey).toBe("manual-current");
  });

  it("does not lose reports when TBA is unavailable or unconfigured", async () => {
    for (const authKey of ["test-key", ""]) {
      const team = await reportsFor(["2099qaoffline"], authKey);
      const result = await jsonAs<Analysis>(team.admin, "/scouting/analysis");
      expect(result.reports).toHaveLength(1);
      expect(result.eventNames).toEqual({});
    }
  });
});
