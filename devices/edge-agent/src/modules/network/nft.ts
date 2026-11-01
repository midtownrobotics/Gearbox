// SPDX-License-Identifier: AGPL-3.0-only
/** Runs `nft` with the given args (and optional script on stdin); returns stdout. */
export async function nft(args: string[], stdin?: string) {
  const proc = Bun.spawn(["nft", ...args], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`nft ${args.join(" ")} failed: ${err.trim()}`);
  return out;
}
