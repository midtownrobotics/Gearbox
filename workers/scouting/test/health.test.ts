import { call } from "@g3/testing/worker";
import { expect, it } from "vitest";

it("answers /scouting/health", async () => {
  const res = await call("/scouting/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    status: "ok",
    version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    service: "scouting",
  });
});

it("answers the same at /api/scouting/health, its production address", async () => {
  const res = await call("/api/scouting/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});
