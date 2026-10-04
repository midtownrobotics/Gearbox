import { call } from "@g3/testing/worker";
import { expect, it } from "vitest";
import packageJson from "../package.json";

it("answers /api/health with Portal's version", async () => {
  const res = await call("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    status: "ok",
    service: "portal",
    version: packageJson.version,
  });
});

it("has no other API", async () => {
  expect((await call("/api/anything")).status).toBe(404);
});
