// SPDX-License-Identifier: AGPL-3.0-only
import { getDomain } from "tldts";

export const UNKNOWN_SITE = "(unknown)";
export const OTHER_SITE = "(other)";

/** "rr3---sn-abc.googlevideo.com" → "googlevideo.com"; "www.bbc.co.uk" → "bbc.co.uk". */
export function siteFor(name: string): string {
  const clean = name.toLowerCase().replace(/\.$/, "");
  return getDomain(clean) ?? clean;
}
