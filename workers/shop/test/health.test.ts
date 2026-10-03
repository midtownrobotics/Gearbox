import { call } from "@g3/testing/worker";
import { expect, it } from "vitest";

it("answers /health", async () => {
  const res = await call("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", service: "shop" });
});
