import { env } from "cloudflare:test";
import { admin, kioskAdmin, mentor, otherStudent, student } from "@g3/testing/users";
import { call, jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";

const database = (env as unknown as { SCHEDULE_DB: D1Database }).SCHEDULE_DB;

it("needs a signed-in user", async () => {
  expect((await call("/me")).status).toBe(401);
});

it("says who is signed in, their roles and whether they edit schedules", async () => {
  expect(await jsonAs(student, "/me")).toMatchObject({
    userId: student.id,
    isMentor: false,
    isAdmin: false,
    canEdit: false,
  });
  expect(await jsonAs(mentor, "/me")).toMatchObject({ isMentor: true, canEdit: true });
  expect(await jsonAs(admin, "/me")).toMatchObject({ isAdmin: true, canEdit: true });
  // A kiosk PIN session never has a role, even an admin's.
  expect(await jsonAs(kioskAdmin, "/me")).toMatchObject({
    isMentor: false,
    isAdmin: false,
    canEdit: false,
  });
});

it("lets a student mentors trusted edit schedules, in their own team only", async () => {
  await database
    .prepare(
      "INSERT INTO schedule_editors (team_id, user_id, added_by, added_at) VALUES (?, ?, ?, 0)",
    )
    .bind(otherStudent.teamId, otherStudent.id, mentor.id)
    .run();
  expect(await jsonAs(otherStudent, "/me")).toMatchObject({ isMentor: false, canEdit: true });
  expect(await jsonAs(student, "/me")).toMatchObject({ canEdit: false });

  await database
    .prepare(
      "INSERT INTO schedule_editors (team_id, user_id, added_by, added_at) VALUES ('frc999999', ?, ?, 0)",
    )
    .bind(student.id, mentor.id)
    .run();
  expect(await jsonAs(student, "/me")).toMatchObject({ canEdit: false });
});
