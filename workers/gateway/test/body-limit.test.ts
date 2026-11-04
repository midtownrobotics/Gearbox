// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { MAX_API_BODY_BYTES, limitRequestBody } from "../src/body-limit";

describe("API JSON size limit", () => {
  it("preserves ordinary JSON bodies and headers", async () => {
    const result = await limitRequestBody(
      new Request("https://example.com/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "session" },
        body: '{"name":"Test"}',
      }),
    );
    expect(result).toBeInstanceOf(Request);
    expect(await (result as Request).json()).toEqual({ name: "Test" });
    expect(result.headers.get("Cookie")).toBe("session");
  });

  it("rejects chunked oversized JSON without relying on content length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_API_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    const result = await limitRequestBody(
      new Request("https://example.com/api/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    );
    expect((result as Response).status).toBe(413);
  });

  it("leaves binary and multipart uploads for their route-specific limits", async () => {
    const request = new Request("https://example.com/api/~pit/downloader/logs/1/parts/1", {
      method: "POST",
      body: new Uint8Array(3),
    });
    expect(await limitRequestBody(request)).toBe(request);
    expect((await request.arrayBuffer()).byteLength).toBe(3);
  });

  it("does not let a false content type bypass the ordinary endpoint limit", async () => {
    const result = await limitRequestBody(
      new Request("https://example.com/api/~platform/signup", {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=pretend" },
        body: new Uint8Array(MAX_API_BODY_BYTES + 1),
      }),
    );
    expect((result as Response).status).toBe(413);
  });
});
