import { ErrorBanner, Loading, Page, buttonClass } from "@g3/ui";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { drawingUrl, fetchOnshapeReleases } from "../../shared/getters";
import type { OnshapeRelease } from "../../shared/types";
import { ExternalLink, linkCls, td, th, when } from "./release-ui";

// One Onshape release (/onshape/releases/:id, the row id from GET /onshape/releases): who made and
// approved it, its notes, its parts with links to Onshape at that release, and its comments.

export function ReleasePage() {
  const { id } = useParams();
  // Opened from Ingest's release headers: the back link goes there instead of the list.
  const fromIngest = (useLocation().state as { from?: string } | null)?.from === "ingest";
  const back = (
    <Link
      to={fromIngest ? "/ingest" : "/onshape"}
      className="text-sm text-secondary-500 hover:text-primary-600"
    >
      {fromIngest ? "← Ingest" : "← Onshape"}
    </Link>
  );
  const [release, setRelease] = useState<OnshapeRelease | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchOnshapeReleases()
      .then((all) => setRelease(all.find((r) => String(r.id) === id) ?? null))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load the release."));
  }, [id]);

  if (error || !release)
    return (
      <Page title="Release" actions={back}>
        {error || release === null ? (
          <ErrorBanner message={error ?? "There's no such release."} />
        ) : (
          <Loading />
        )}
      </Page>
    );

  const approved = release.approvers.filter((a) => a.approvedAt);
  const rejected = release.approvers.filter((a) => a.rejectedAt);
  const waiting = release.approvers.filter((a) => !a.approvedAt && !a.rejectedAt);
  const facts: [string, string][] = [
    ["Released", when(release.releasedAt) ?? release.releasedAt],
    ...(release.state ? [["State", release.state] as [string, string]] : []),
    ...(release.madeBy
      ? [
          ["Made by", `${release.madeBy}${release.madeAt ? `, ${when(release.madeAt)}` : ""}`] as [
            string,
            string,
          ],
        ]
      : []),
    ...approved.map((a) => ["Approved by", `${a.name}, ${when(a.approvedAt)}`] as [string, string]),
    ...rejected.map((a) => ["Rejected by", `${a.name}, ${when(a.rejectedAt)}`] as [string, string]),
    ...(waiting.length > 0
      ? [["Didn't respond", waiting.map((a) => a.name).join(", ")] as [string, string]]
      : []),
    ["Release ID", release.releaseId],
  ];

  return (
    <Page
      title={release.name ?? "Release"}
      description={
        release.notes && release.notes !== release.name ? (
          <span className="whitespace-pre-line">{release.notes}</span>
        ) : undefined
      }
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {back}
          <a
            href={release.links.release}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("secondary", "sm")}
          >
            Open in Onshape
          </a>
          {release.links.document && (
            <a
              href={release.links.document}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("secondary", "sm")}
            >
              View document at this release
            </a>
          )}
        </div>
      }
    >
      <>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-xl border border-secondary-200 bg-surface px-4 py-3 text-sm">
          {facts.map(([label, value]) => (
            <div key={`${label}${value}`} className="contents">
              <dt className="text-secondary-400">{label}</dt>
              <dd className="min-w-0 break-words text-secondary-900">{value}</dd>
            </div>
          ))}
        </dl>

        <section className="space-y-2">
          <h2 className="font-sans text-lg font-semibold text-secondary-900">
            {release.parts.length} {release.parts.length === 1 ? "part" : "parts"}
          </h2>
          {release.parts.length === 0 ? (
            <p className="text-sm text-secondary-400">No parts were recorded for this release.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-secondary-200 bg-surface">
              <table className="w-full text-sm">
                <thead className="bg-page">
                  <tr>
                    <th className={th}>Part number</th>
                    <th className={th}>Name</th>
                    <th className={th}>Rev</th>
                    <th className={`${th} text-right`}>Qty</th>
                    <th className={th}>Open</th>
                  </tr>
                </thead>
                <tbody>
                  {release.parts.map((part) => (
                    <tr key={part.id} className="border-t border-secondary-200">
                      <td className={`${td} font-mono whitespace-nowrap`}>
                        <span className="text-secondary-900">{part.partNumber}</span>
                      </td>
                      <td className={`${td} text-secondary-900`}>
                        {part.name && part.name !== part.partNumber ? part.name : ""}
                        {part.description && (
                          <span className="block text-xs text-secondary-400">
                            {part.description}
                          </span>
                        )}
                      </td>
                      <td className={`${td} text-secondary-900`}>{part.revision ?? "–"}</td>
                      <td className={`${td} text-secondary-900 text-right tabular-nums`}>
                        {part.quantity ?? "–"}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <span className="flex gap-3">
                          <Link
                            to={`/part?p=${encodeURIComponent(part.partNumber)}`}
                            className={linkCls}
                          >
                            Part
                          </Link>
                          {part.links.drawing && part.revision && (
                            <a
                              href={drawingUrl(part.partNumber, part.revision)}
                              target="_blank"
                              rel="noreferrer"
                              className={linkCls}
                            >
                              Drawing
                            </a>
                          )}
                          {part.links.part && (
                            <ExternalLink href={part.links.part}>Onshape</ExternalLink>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {release.comments.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-sans text-lg font-semibold text-secondary-900">Comments</h2>
            <ul className="divide-y divide-secondary-200 rounded-xl border border-secondary-200 bg-surface">
              {release.comments.map((comment, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: comments are shown as stored, never reordered
                <li key={i} className="px-4 py-3 text-sm">
                  <span className="font-medium text-secondary-900">{comment.by ?? "Someone"}</span>
                  {comment.at && <span className="text-secondary-400"> · {when(comment.at)}</span>}
                  <p className="mt-0.5 whitespace-pre-line text-secondary-900">{comment.message}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    </Page>
  );
}
