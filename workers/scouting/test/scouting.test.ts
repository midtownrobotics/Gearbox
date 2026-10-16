import { env } from "cloudflare:workers";
import { teamKey } from "@g3/site-config";
import { admin, kioskAdmin, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/types";

// Scouting, served under /scouting. Strategy leads (G3ID admins, or people a G3ID
// admin made a lead) manage forms; anyone signed in scouts and keeps tier lists.

const form = {
  name: "Match scouting",
  fields: [{ id: "auto", label: "Auto points", type: "counter" }],
};

describe("sign-in and roles", () => {
  it("needs a G3ID session (the local auth bypass is off)", async () => {
    expect((await call("/scouting/me")).status).toBe(401);
    expect((await call("/scouting/tier-lists")).status).toBe(401);
  });

  it("reports who's a strategy lead", async () => {
    expect(await jsonAs(student, "/scouting/me")).toMatchObject({
      userId: student.id,
      isAdmin: false,
    });
    expect(await jsonAs(admin, "/scouting/me")).toMatchObject({ isAdmin: true, isG3IdAdmin: true });
    expect(await jsonAs(kioskAdmin, "/scouting/me")).toMatchObject({ isAdmin: false });
  });

  it("keeps scouting forms to strategy leads", async () => {
    const create = (user: typeof student) =>
      callAs(user, "/scouting/scouting-forms", { method: "POST", body: form });
    expect((await create(student)).status).toBe(403);
    expect((await create(kioskAdmin)).status).toBe(403);
    expect((await create(admin)).status).toBe(201);
    const forms = await jsonAs<{ forms: { name: string }[] }>(student, "/scouting/scouting-forms");
    expect(forms.forms.map((f) => f.name)).toContain("Match scouting");
  });

  it("lets only G3ID admins make strategy leads, who can then manage forms", async () => {
    const grant = (user: typeof student) =>
      callAs(user, "/scouting/strategy-admins", { method: "POST", body: { userId: student.id } });
    expect((await grant(student)).status).toBe(403);
    expect((await grant(admin)).status).toBe(201);
    expect(await jsonAs(student, "/scouting/me")).toMatchObject({
      isAdmin: true,
      isG3IdAdmin: false,
    });
    expect(
      (await callAs(student, "/scouting/scouting-forms", { method: "POST", body: form })).status,
    ).toBe(201);
    // A lead can't make more leads.
    expect((await grant(student)).status).toBe(403);
  });

  it("rejects a form without valid fields", async () => {
    const res = await callAs(admin, "/scouting/scouting-forms", {
      method: "POST",
      body: { name: "Empty", fields: [] },
    });
    expect(res.status).toBe(400);
  });
});

describe("tier lists", () => {
  it("creates, updates and deletes one", async () => {
    const { id } = await jsonAs<{ id: string }>(
      student,
      "/scouting/tier-lists",
      { method: "POST", body: { name: "Picks", tiers: [] } },
      201,
    );
    const tiers = [{ id: "s", name: "S", color: "#a32035", items: ["9999"] }];
    await jsonAs(student, `/scouting/tier-lists/${id}`, {
      method: "PUT",
      body: { name: "Picks v2", tiers },
    });
    const lists = await jsonAs<{ tierLists: { id: string; name: string; tiers: unknown }[] }>(
      student,
      "/scouting/tier-lists",
    );
    expect(lists.tierLists.find((l) => l.id === id)).toMatchObject({ name: "Picks v2", tiers });
    await jsonAs(student, `/scouting/tier-lists/${id}`, { method: "DELETE" });
    const after = await jsonAs<{ tierLists: { id: string }[] }>(student, "/scouting/tier-lists");
    expect(after.tierLists.map((l) => l.id)).not.toContain(id);
  });

  it("needs a name", async () => {
    const res = await callAs(student, "/scouting/tier-lists", {
      method: "POST",
      body: { tiers: [] },
    });
    expect(res.status).toBe(400);
  });
});

// A number a scout records is their answer, 0 included: a robot that scored
// nothing scored nothing. Counters have no maximum to set on a form, so a count
// past the field's stored default (fuel, cycles) is an answer too.
describe("number answers", () => {
  const db = (env as unknown as AppEnv["Bindings"]).SCOUTING_DB;

  const submitAnswers = async (
    field: Record<string, unknown>,
    answers: Record<string, unknown>,
  ) => {
    const eventKey = `manual-${crypto.randomUUID()}`;
    const { id } = await jsonAs<{ id: string }>(
      admin,
      "/scouting/scouting-forms",
      { method: "POST", body: { name: "Match", fields: [field] } },
      201,
    );
    await db
      .prepare(
        "INSERT INTO strategy_event_config (team_id, id, event_key, current_match_number, updated_by, updated_at, schedule_mode) VALUES (?, 1, ?, 1, ?, ?, 'manual') ON CONFLICT (team_id, id) DO UPDATE SET event_key = excluded.event_key, current_match_number = 1",
      )
      .bind(teamKey, eventKey, admin.id, Date.now())
      .run();
    await db
      .prepare(
        "INSERT OR IGNORE INTO scouting_match_assignments (team_id, event_key, match_number, user_id, team_number, assigned_at) VALUES (?, ?, 1, ?, '9999', ?)",
      )
      .bind(teamKey, eventKey, student.id, Date.now())
      .run();
    const body = new FormData();
    body.set("answers", JSON.stringify(answers));
    const response = await callAs(student, `/scouting/scouting-forms/${id}/submissions`, {
      method: "POST",
      body,
    });
    const stored = await db
      .prepare("SELECT answers_json FROM scouting_form_submissions WHERE form_id = ?")
      .bind(id)
      .first<{ answers_json: string }>();
    return { status: response.status, stored: JSON.parse(stored?.answers_json ?? "{}") };
  };

  const counter = { id: "autoFuel", label: "Auto Fuel", type: "counter" };
  const submitCount = (count: unknown) =>
    submitAnswers(counter, count === undefined ? {} : { autoFuel: count });
  // A rating slider carries its own range, and this one starts at 0.
  const slider = {
    id: "defense",
    label: "Defense rating",
    type: "slider",
    min: 0,
    max: 5,
    step: 1,
  };
  const submitRating = (rating: unknown) =>
    submitAnswers(slider, rating === undefined ? {} : { defense: rating });

  it("takes a count past the field's default range", async () => {
    expect(await submitCount(30)).toEqual({ status: 201, stored: { autoFuel: 30 } });
  });

  it("keeps a count of 0, so a robot that scored nothing is recorded", async () => {
    expect(await submitCount(0)).toEqual({ status: 201, stored: { autoFuel: 0 } });
  });

  it("counts an untouched counter as 0, the number the app shows", async () => {
    expect(await submitCount(undefined)).toEqual({ status: 201, stored: { autoFuel: 0 } });
  });

  it("refuses a count that isn't a whole number of 0 or more", async () => {
    expect((await submitCount(-5)).status).toBe(400);
    expect((await submitCount(2.5)).status).toBe(400);
  });

  it("keeps a rating of 0 when the slider's range starts there", async () => {
    expect(await submitRating(0)).toEqual({ status: 201, stored: { defense: 0 } });
    expect(await submitRating(5)).toEqual({ status: 201, stored: { defense: 5 } });
  });

  it("still needs the slider answered, since it records nothing until it's moved", async () => {
    expect((await submitRating(undefined)).status).toBe(400);
  });

  it("refuses a rating outside the slider's range", async () => {
    expect((await submitRating(9)).status).toBe(400);
    expect((await submitRating(-1)).status).toBe(400);
  });
});
