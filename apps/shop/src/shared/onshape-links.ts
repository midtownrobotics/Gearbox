import { useEffect, useMemo, useState } from "react";
import { fetchOnshapeLinks } from "./getters";
import type { OnshapePartLink } from "./types";

/** The team's Onshape links by part number, each part's newest release first. */
export type OnshapeLinks = Map<string, OnshapePartLink[]>;

/**
 * The team's Onshape links, loaded once. Onshape only decides whether names are links, so a team
 * without it, or a failed load, gets none and the page shows plain names.
 */
export function useOnshapeLinks(): OnshapeLinks {
  const [list, setList] = useState<OnshapePartLink[]>([]);
  useEffect(() => {
    fetchOnshapeLinks()
      .then(setList)
      .catch(() => {});
  }, []);
  return useMemo(() => {
    const links: OnshapeLinks = new Map();
    for (const link of list) {
      const parts = links.get(link.partNumber);
      if (parts) parts.push(link);
      else links.set(link.partNumber, [link]);
    }
    return links;
  }, [list]);
}

/**
 * Where a part is in Onshape: the release that gave it the revision asked for, else its newest
 * one, since a part's number is what Onshape releases and a hand-typed revision may match none.
 */
export function onshapeLinkFor(
  links: OnshapeLinks,
  partNumber: string,
  revision: string | null,
): OnshapePartLink | null {
  const released = links.get(partNumber);
  if (!released) return null;
  return released.find((l) => l.revision === revision) ?? released[0] ?? null;
}

/** A release package in Onshape, by its Onshape id, when the team's links hold it. */
export function onshapeReleaseLink(links: OnshapeLinks, releaseId: string): string | null {
  for (const parts of links.values()) {
    const link = parts.find((l) => l.releaseId === releaseId);
    if (link) return link.release;
  }
  return null;
}
