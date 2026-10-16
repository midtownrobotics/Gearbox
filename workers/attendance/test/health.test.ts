import { call } from "@g3/testing/worker";
import { expect, it } from "vitest";

it("answers /health", async () => {
  const res = await call("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    status: "ok",
    version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    service: "attendance",
  });
});

it("answers the same at /api/health, its production address", async () => {
  const res = await call("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});
