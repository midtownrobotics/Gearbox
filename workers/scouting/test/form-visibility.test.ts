import { env } from "cloudflare:workers";
import { withTeam } from "@g3/auth";
import { newTeamId, teamUsers } from "@g3/testing/users";
import { callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db";
import { scoutingFormSubmissions } from "../src/db/schema";
import type { AppEnv } from "../src/types";

const db = createDb((env as unknown as AppEnv["Bindings"]).SCOUTING_DB);
type Forms = { forms: { id: string; name: string; isActive: boolean; fields: unknown[] }[] };

describe("form visibility", () => {
  it("hides forms from scouts, retains them for managers and preserves existing reports", async () => {
    const team = teamUsers(newTeamId());
    const { id } = await jsonAs<{ id: string }>(
      team.admin,
      "/scouting/scouting-forms",
      {
        method: "POST",
        body: {
          name: "Match notes",
          kind: "scouting",
          fields: [{ id: "count", label: "Count", type: "counter" }],
        },
      },
      201,
    );
    const reportId = crypto.randomUUID();
    await db.insert(scoutingFormSubmissions).values(
      withTeam(team.teamId, {
        id: reportId,
        form_id: id,
        answers_json: '{"count":4}',
        submitted_by: team.student.id,
        submitted_by_name: "Scout",
        created_at: Date.now(),
        team_name: "123",
      }),
    );
    const before = (await jsonAs<Forms>(team.admin, "/scouting/scouting-forms")).forms.find(
      (form) => form.id === id,
    );
    await jsonAs(team.admin, `/scouting/scouting-forms/${id}/visibility`, {
      method: "PUT",
      body: { isActive: false },
    });
    await jsonAs(team.admin, `/scouting/scouting-forms/${id}`, {
      method: "PUT",
      body: { name: "Match notes", fields: [{ id: "count", label: "Count", type: "counter" }] },
    });
    expect(
      (await jsonAs<Forms>(team.student, "/scouting/scouting-forms")).forms.some(
        (form) => form.id === id,
      ),
    ).toBe(false);
    expect(
      (await jsonAs<Forms>(team.admin, "/scouting/scouting-forms")).forms.find(
        (form) => form.id === id,
      ),
    ).toMatchObject({ name: before?.name, fields: before?.fields, isActive: false });
    expect(
      (
        await callAs(team.student, `/scouting/scouting-forms/${id}/submissions`, {
          method: "POST",
          body: new FormData(),
        })
      ).status,
    ).toBe(404);
    const analysis = await jsonAs<{ reports: { id: string }[] }>(
      team.student,
      "/scouting/analysis",
    );
    expect(analysis.reports.some((report) => report.id === reportId)).toBe(true);
    await jsonAs(team.admin, `/scouting/scouting-forms/${id}/visibility`, {
      method: "PUT",
      body: { isActive: true },
    });
    expect(
      (await jsonAs<Forms>(team.student, "/scouting/scouting-forms")).forms.find(
        (form) => form.id === id,
      ),
    ).toMatchObject({ name: before?.name, fields: before?.fields, isActive: true });
  });

  it("requires management permission, isolates organizations and validates the visibility flag", async () => {
    const team = teamUsers(newTeamId());
    const other = teamUsers(newTeamId());
    const { id } = await jsonAs<{ id: string }>(
      team.admin,
      "/scouting/scouting-forms",
      {
        method: "POST",
        body: { name: "Private form", fields: [{ id: "count", label: "Count", type: "counter" }] },
      },
      201,
    );
    const path = `/scouting/scouting-forms/${id}/visibility`;
    expect(
      (await callAs(team.student, path, { method: "PUT", body: { isActive: false } })).status,
    ).toBe(403);
    expect(
      (await callAs(team.kioskAdmin, path, { method: "PUT", body: { isActive: false } })).status,
    ).toBe(403);
    expect(
      (await callAs(other.admin, path, { method: "PUT", body: { isActive: false } })).status,
    ).toBe(404);
    expect(
      (await callAs(team.admin, path, { method: "PUT", body: { isActive: "false" } })).status,
    ).toBe(400);
    expect(
      (await jsonAs<Forms>(team.admin, "/scouting/scouting-forms")).forms.find(
        (form) => form.id === id,
      )?.isActive,
    ).toBe(true);
  });

  it("can hide and restore empty starter forms without changing their questions", async () => {
    const team = teamUsers(newTeamId());
    await jsonAs(team.admin, "/scouting/scouting-forms");
    const path = "/scouting/scouting-forms/form_pit_scouting/visibility";
    await jsonAs(team.admin, path, { method: "PUT", body: { isActive: false } });
    expect(
      (await jsonAs<Forms>(team.student, "/scouting/scouting-forms")).forms.some(
        (form) => form.id === "form_pit_scouting",
      ),
    ).toBe(false);
    await jsonAs(team.admin, path, { method: "PUT", body: { isActive: true } });
    expect(
      (await jsonAs<Forms>(team.student, "/scouting/scouting-forms")).forms.find(
        (form) => form.id === "form_pit_scouting",
      )?.fields,
    ).toEqual([]);
  });
});
