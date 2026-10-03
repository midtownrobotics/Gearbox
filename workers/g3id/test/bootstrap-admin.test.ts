import { expect, it } from "vitest";
import { cookieFrom, createUser, g3id } from "./helpers";

// Its own file: it depends on the database having no admins yet.

it("creates the admin@localhost bootstrap admin only while there are no admins", async () => {
  const first = await g3id("/auth/login/email", {
    method: "POST",
    body: { email: "admin@localhost", password: "password" },
  });
  expect(first.status).toBe(200);
  const me = await g3id("/auth/me", { cookie: cookieFrom(first) as string });
  expect(await me.json()).toMatchObject({ email: "admin@localhost", isAdmin: true });

  // With an admin around, a wrong bootstrap password doesn't recreate or reset anything.
  await createUser({ isAdmin: true });
  const wrong = await g3id("/auth/login/email", {
    method: "POST",
    body: { email: "admin@localhost", password: "not-it" },
  });
  expect(wrong.status).toBe(401);
});
