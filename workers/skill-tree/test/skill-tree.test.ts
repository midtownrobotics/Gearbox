import { admin, kioskAdmin, mentor, otherStudent, student } from "@g3/testing/users";
import { call, callAs, jsonAs } from "@g3/testing/worker";
import { describe, expect, it } from "vitest";

// Skill Tree: students have a tree of skills; mentors (G3ID admins, G3ID mentors, or people a
// mentor added) mark progress, never from a kiosk PIN session.

describe("sign-in and profiles", () => {
  it("needs a G3ID session", async () => {
    expect((await call("/me")).status).toBe(401);
    expect((await call("/students")).status).toBe(401);
  });

  it("gives students a tree on first visit, but not G3ID mentors", async () => {
    expect(await jsonAs(student, "/me")).toMatchObject({ id: student.id, isMentor: false });
    expect(await jsonAs(mentor, "/me")).toMatchObject({ id: mentor.id, isMentor: true });
    const ids = (await jsonAs<{ id: string }[]>(student, "/students")).map((s) => s.id);
    expect(ids).toContain(student.id);
    expect(ids).not.toContain(mentor.id);
  });

  it("treats G3ID admins as mentors", async () => {
    expect(await jsonAs(admin, "/me")).toMatchObject({ isMentor: true });
    expect(await jsonAs(student, `/mentors/${admin.id}`)).toEqual({ exists: true });
  });
});

describe("progress", () => {
  const mark = (user: typeof student, target: string, status: string) =>
    callAs(user, `/students/${target}`, {
      method: "PATCH",
      body: { skillId: "cad-basics", status },
    });

  it("lets mentors mark a student's skills", async () => {
    await jsonAs(student, "/me");
    await jsonAs(mentor, "/me");
    expect((await mark(mentor, student.id, "complete")).status).toBe(200);
    const me = (
      await jsonAs<{ id: string; progress: Record<string, string> }[]>(student, "/students")
    ).find((s) => s.id === student.id);
    expect(me?.progress).toEqual({ "cad-basics": "complete" });
  });

  it("doesn't let students or kiosk sessions mark progress", async () => {
    await jsonAs(admin, "/me");
    expect((await mark(student, otherStudent.id, "complete")).status).toBe(403);
    expect((await mark(student, student.id, "complete")).status).toBe(403);
    expect((await mark(kioskAdmin, student.id, "complete")).status).toBe(403);
  });

  it("rejects unknown statuses", async () => {
    expect((await mark(mentor, student.id, "done-ish")).status).toBe(400);
  });
});

describe("mentors", () => {
  it("lets a mentor add and remove mentors", async () => {
    await jsonAs(mentor, "/me");
    expect((await callAs(mentor, `/mentors/${student.id}`, { method: "POST" })).status).toBe(200);
    expect(await jsonAs(student, `/mentors/${student.id}`)).toEqual({ exists: true });
    expect((await callAs(mentor, `/mentors/${student.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await jsonAs(student, `/mentors/${student.id}`)).toEqual({ exists: false });
  });

  it("keeps mentor management from students and kiosk sessions", async () => {
    expect((await callAs(otherStudent, "/mentors")).status).toBe(403);
    expect(
      (await callAs(otherStudent, `/mentors/${otherStudent.id}`, { method: "POST" })).status,
    ).toBe(403);
    expect((await callAs(kioskAdmin, "/mentors")).status).toBe(403);
  });
});
