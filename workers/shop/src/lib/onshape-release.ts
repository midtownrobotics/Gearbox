import { type OnshapeCredentials, basicAuth } from "./onshape-config";

// An approved Onshape release package (GET /api/v10/releasepackages/:id): what it's called, who
// made and approved it, and the parts and drawings in it with their part numbers and revisions.
// The BOM queue job reads it once the release is approved (lib/bom-queue-consumer.ts).

export type ReleaseApprover = {
  name: string;
  /** ISO times from Onshape; null until they've approved (or rejected) it. */
  approvedAt: string | null;
  rejectedAt: string | null;
};

export type ReleaseComment = { by: string | null; message: string; at: string | null };

export type ReleaseDetails = {
  name: string | null;
  notes: string | null;
  state: string | null;
  documentId: string | null;
  versionId: string | null;
  madeBy: string | null;
  madeAt: string | null;
  approvers: ReleaseApprover[];
  comments: ReleaseComment[];
};

/** One part, assembly or drawing in the release, by Onshape's element type (0, 1, 2). */
export type ReleaseItem = {
  partNumber: string;
  elementType: number;
  elementId: string;
  versionId: string;
  name: string | null;
  revision: string | null;
  description: string | null;
};

export const ELEMENT_PART_STUDIO = 0;
export const ELEMENT_DRAWING = 2;

type Property = { name?: string; value?: unknown; isApproverProperty?: boolean };
type User = { name?: string } | null;

type ReleasePackage = {
  name?: string;
  description?: string;
  documentId?: string;
  versionId?: string;
  createdAt?: string;
  createdBy?: User;
  workflow?: { state?: { displayName?: string }; metadataState?: string } | null;
  properties?: Property[];
  comments?: { message?: string; createdAt?: string; user?: User }[];
  items?: {
    name?: string;
    elementType?: number;
    elementId?: string;
    versionId?: string;
    properties?: Property[];
  }[];
};

const text = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const property = (properties: Property[] | undefined, name: string) =>
  properties?.find((p) => p.name === name)?.value;

export function parseReleasePackage(pkg: ReleasePackage): {
  details: ReleaseDetails;
  items: ReleaseItem[];
} {
  const approverValue = pkg.properties?.find((p) => p.isApproverProperty)?.value;
  const approvers = (Array.isArray(approverValue) ? approverValue : []).flatMap((a) => {
    const entry = a as { name?: string; approvalDate?: string; rejectionDate?: string };
    const name = text(entry.name);
    return name
      ? [{ name, approvedAt: text(entry.approvalDate), rejectedAt: text(entry.rejectionDate) }]
      : [];
  });

  const comments = (pkg.comments ?? []).flatMap((c) => {
    const message = text(c.message);
    return message ? [{ by: text(c.user?.name), message, at: text(c.createdAt) }] : [];
  });

  const items = (pkg.items ?? []).flatMap((item) => {
    const partNumber = text(property(item.properties, "Part number"));
    const { elementType, elementId, versionId } = item;
    if (!partNumber || typeof elementType !== "number" || !elementId || !versionId) return [];
    return [
      {
        partNumber,
        elementType,
        elementId,
        versionId,
        name: text(property(item.properties, "Name")) ?? text(item.name),
        revision: text(property(item.properties, "Revision")),
        description: text(property(item.properties, "Description")),
      },
    ];
  });

  return {
    details: {
      name: text(pkg.name) ?? text(property(pkg.properties, "Release name")),
      notes: text(property(pkg.properties, "Release notes")) ?? text(pkg.description),
      state: text(pkg.workflow?.state?.displayName) ?? text(pkg.workflow?.metadataState),
      documentId: text(pkg.documentId),
      versionId: text(pkg.versionId),
      madeBy: text(pkg.createdBy?.name),
      madeAt: text(pkg.createdAt),
      approvers,
      comments,
    },
    items,
  };
}

/** The release package from Onshape, or null when it can't be read. */
export async function fetchReleasePackage(releaseId: string, credentials: OnshapeCredentials) {
  try {
    const response = await fetch(
      `https://cad.onshape.com/api/v10/releasepackages/${encodeURIComponent(releaseId)}`,
      { headers: { Authorization: basicAuth(credentials), Accept: "application/json" } },
    );
    if (!response.ok) {
      console.error("[Release Fetch Error]", releaseId, response.status, response.statusText);
      return null;
    }
    return parseReleasePackage((await response.json()) as ReleasePackage);
  } catch (err) {
    console.error("[Release Fetch Error]", releaseId, err);
    return null;
  }
}
