import { expect, it } from "vitest";
import packageJson from "../package.json";
import { g3id } from "./helpers";

it("answers /health", async () => {
  const res = await g3id("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", service: "g3id", version: packageJson.version });
});

it("answers the same at /api/health, its production address", async () => {
  const res = await g3id("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok" });
});
