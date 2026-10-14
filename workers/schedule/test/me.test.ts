import { admin, kioskAdmin, mentor, student } from "@g3/testing/users";
import { call, jsonAs } from "@g3/testing/worker";
import { expect, it } from "vitest";

it("needs a signed-in user", async () => {
  expect((await call("/me")).status).toBe(401);
});

it("says who is signed in and their roles", async () => {
  expect(await jsonAs(student, "/me")).toMatchObject({
    userId: student.id,
    isMentor: false,
    isAdmin: false,
  });
  expect(await jsonAs(mentor, "/me")).toMatchObject({ isMentor: true, isAdmin: false });
  expect(await jsonAs(admin, "/me")).toMatchObject({ isAdmin: true });
  // A kiosk PIN session never has a role, even an admin's.
  expect(await jsonAs(kioskAdmin, "/me")).toMatchObject({ isMentor: false, isAdmin: false });
});
