import { call } from "@g3/testing/worker";
import { expect, it } from "vitest";

it("answers /scouting/health", async () => {
  const res = await call("/scouting/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", service: "scouting" });
});
