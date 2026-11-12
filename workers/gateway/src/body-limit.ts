// SPDX-License-Identifier: AGPL-3.0-only
/** Ordinary API data stays small; multipart and binary uploads have their own route limits. */
export const MAX_API_BODY_BYTES = 2 * 1024 * 1024;

const tooLarge = () =>
  Response.json(
    {
      error: "This request is too large. Send less data at once (up to 2 MB).",
      code: "request_too_large",
    },
    { status: 413, headers: { "Cache-Control": "no-store" } },
  );

export async function limitRequestBody(request: Request): Promise<Request | Response> {
  if (!request.body) return request;
  let path = new URL(request.url).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed paths keep the ordinary request limit.
  }
  path = path.replace(/^\/api\/~[A-Za-z]+(?=\/|$)/, "/api");
  // Exempt actual file routes, never a caller's Content-Type: JSON handlers parse regardless
  // of that header, so using it alone would let a client bypass the limit.
  if (
    ["POST", "PUT"].includes(request.method) &&
    /^\/api\/(part-files|drawings\/upload|scouting\/(field-maps|autos|scouting-forms\/[^/]+\/submissions|manual-schedule\/extract)|scope\/assets|downloader\/logs\/\d+\/parts\/\d+|switch\/(sounds|submissions)|print(?:\/jobs)?)\/?$/.test(
      path,
    )
  )
    return request;
  if (Number(request.headers.get("Content-Length")) > MAX_API_BODY_BYTES) return tooLarge();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_API_BODY_BYTES) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new Request(request, { body: bytes });
}
