// SPDX-License-Identifier: AGPL-3.0-only
import type { StorageAllowance, StorageReport } from "@g3/auth";
import { storageArchiveParts } from "@g3/auth/storage-parts";
import { apiPath } from "@g3/site-config";
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorBanner,
  Loading,
  Page,
  ProgressBar,
  TextField,
  buttonClass,
  tones,
} from "@g3/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platform } from "../../lib/platform";

type AppStorage = {
  slug: string;
  name: string;
  report: StorageReport | null;
  error: string | null;
};
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
      : `${(bytes / 1024).toFixed(1)} KiB`;
const date = (time: number) =>
  new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const download = (app: string, kind: string, params: Record<string, string>) =>
  `${apiPath("platform")}/team/storage/${app}/${kind}?${new URLSearchParams(params)}`;

function ArchiveDownload({
  app,
  allowance,
  files,
  eligible = false,
}: { app: string; allowance: string; files: StorageAllowance["files"]; eligible?: boolean }) {
  const [open, setOpen] = useState(false);
  const parts = storageArchiveParts(files);
  const label = eligible ? "Download eligible files" : "Download all files";
  const link = (part: (typeof parts)[number]) =>
    download(app, "archive", {
      allowance,
      ...(eligible ? { eligible: "1" } : {}),
      from: part.from,
      to: part.to,
    });
  if (parts.length === 1)
    return (
      <a className={buttonClass("secondary", "sm")} href={link(parts[0])}>
        {label}
      </a>
    );
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <Dialog title="Download files" onClose={() => setOpen(false)}>
          <p className="text-sm text-secondary-600">
            This download has {parts.length} archives. Download each part to keep all the files.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {parts.map((part, index) => (
              <a key={part.from} className={buttonClass("secondary", "sm")} href={link(part)}>
                Part {index + 1} ? {part.count} files ? {size(part.bytes)}
              </a>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}

function Allowance({
  app,
  allowance: a,
  preview,
}: { app: string; allowance: StorageAllowance; preview: boolean }) {
  const [query, setQuery] = useState("");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [page, setPage] = useState(0);
  const percent = Math.max(
    a.byteLimit ? (a.bytes / a.byteLimit) * 100 : 0,
    (a.count / a.countLimit) * 100,
  );
  const eligible = a.files.filter((file) => file.eligible);
  const files = a.files
    .filter(
      (file) =>
        (!eligibleOnly || file.eligible) && file.name.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.eligible) - Number(a.eligible) ||
        (a.uploadedAt ?? Number.POSITIVE_INFINITY) - (b.uploadedAt ?? Number.POSITIVE_INFINITY) ||
        a.name.localeCompare(b.name),
    );
  const pageCount = Math.max(1, Math.ceil(files.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-secondary-900">{a.name}</h2>
          <p className="mt-1 text-sm text-secondary-600">
            {size(a.bytes)}
            {a.byteLimit ? ` of ${size(a.byteLimit)}` : " stored"} · {a.count.toLocaleString()} of{" "}
            {a.countLimit.toLocaleString()} {a.countLabel}
          </p>
        </div>
        <Badge
          colors={percent >= 100 ? tones.danger : percent >= 90 ? tones.warning : tones.neutral}
        >
          {Math.floor(percent)}% used
        </Badge>
      </div>
      <div className="mt-4">
        <ProgressBar percent={Math.min(percent, 100)} />
      </div>
      {percent >= 90 && (
        <p className={`mt-3 text-sm ${percent >= 100 ? "text-red-700" : "text-amber-700"}`}>
          {percent >= 100
            ? "At capacity. Save a copy of files you want to keep before adding more."
            : "Nearly full. Download older files you want to keep."}
        </p>
      )}
      <p className="mt-3 text-sm text-secondary-600">
        {eligible.length.toLocaleString()} files ({size(eligible.reduce((n, f) => n + f.bytes, 0))})
        eligible for cleanup. Oldest eligible files are removed first when a save exceeds this
        allowance.
      </p>
      {a.cleanupEnabled === false && (
        <p className="mt-2 text-sm text-secondary-600">
          Automatic cleanup is off for logs. New logs wait when full. A mentor or admin can change
          this on the Logs page in Pit.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {preview ? (
          <Button variant="secondary" size="sm" disabled>
            Download all files
          </Button>
        ) : (
          a.files.length > 0 && <ArchiveDownload app={app} allowance={a.id} files={a.files} />
        )}
        {!preview && eligible.length > 0 && (
          <ArchiveDownload app={app} allowance={a.id} files={eligible} eligible />
        )}
      </div>
      {a.files.length > 0 ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <TextField
                type="search"
                typeable
                aria-label={`Search ${a.name}`}
                placeholder="Find a file"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-secondary-700">
              <input
                type="checkbox"
                checked={eligibleOnly}
                onChange={(event) => {
                  setEligibleOnly(event.target.checked);
                  setPage(0);
                }}
              />
              Eligible only
            </label>
          </div>
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-secondary-500">
                <tr>
                  <th className="py-2 pr-4">File</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2 pr-4">Saved</th>
                  <th className="py-2 pr-4">Cleanup</th>
                  <th className="py-2">
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {files.slice(currentPage * 25, (currentPage + 1) * 25).map((file) => (
                  <tr key={file.key}>
                    <td className="max-w-64 py-3 pr-4 text-secondary-900">
                      <span className="block truncate" title={file.name}>
                        {file.name}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-secondary-600">
                      {size(file.bytes)}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-4 text-secondary-600">
                      {file.uploadedAt ? date(file.uploadedAt) : "Unknown"}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge colors={file.eligible ? tones.warning : tones.neutral}>
                        {file.eligible ? "Eligible" : "Protected"}
                      </Badge>
                      {!file.eligible && file.eligibleAfter && (
                        <p className="mt-1 text-xs text-secondary-500">
                          Eligible after {date(file.eligibleAfter)}
                        </p>
                      )}
                    </td>
                    <td className="py-3">
                      {preview ? (
                        <span className="text-secondary-400">Preview</span>
                      ) : (
                        <a
                          className={buttonClass("secondary", "sm")}
                          href={download(app, "download", { key: file.key })}
                        >
                          Download
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {files.length === 0 && (
            <p className="py-4 text-sm text-secondary-500">No matching files.</p>
          )}
          {pageCount > 1 && (
            <div className="mt-3 flex items-center justify-between gap-3 text-sm text-secondary-600">
              <span>
                Page {currentPage + 1} of {pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={currentPage + 1 >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-secondary-500">No stored files.</p>
      )}
    </Card>
  );
}

export function StoragePage({ preview = false }: { preview?: boolean }) {
  const [apps, setApps] = useState<AppStorage[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (preview && import.meta.env.DEV) {
        const { storagePreview } = await import("./storage-preview");
        setApps(storagePreview());
      } else setApps((await platform<{ apps: AppStorage[] }>("/team/storage")).apps);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [preview]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Page
      title="Storage"
      description="Check your team's usage and download files you want to keep."
      actions={
        <Button variant="secondary" disabled={loading} onClick={() => void refresh()}>
          {loading ? "Checking…" : "Refresh usage"}
        </Button>
      }
    >
      {preview && (
        <Card>
          <p className="text-sm text-amber-700">
            Local preview with sample data. Downloads and alerts are disabled here.
          </p>
        </Card>
      )}
      <Card title="Keep a copy before cleanup">
        <p className="text-sm text-secondary-700">
          Only files strictly older than six months are eligible. When a new save exceeds a cap, the
          oldest eligible files may be permanently deleted toward 90% usage. There is no scheduled
          deletion date. Pit match logs also follow the team's choice on Logs. Newer files are
          protected; saves pause if eligible files cannot make room.
        </p>
        <p className="mt-2 text-sm text-secondary-600">
          Admins receive warnings at 90%, 95%, and 100% on the team's connected chat. Each warning
          is sent once until usage falls below 85%. Cleanup summaries follow actual deletions.
        </p>
        <p className="mt-2 text-sm text-secondary-600">
          Group downloads are .tar archives with a file list. Unzip any .gz files inside before
          opening them. Downloading keeps the originals here.
        </p>
        <p className="mt-2 text-sm text-secondary-600">
          These allowances cover uploaded files in Shop, Scouting, and Pit. Report text and auton
          steps are kept. Older Scouting files saved before team storage was introduced are outside
          these allowances. Switching an app off has its separate 90-day retention period.
        </p>
      </Card>
      <Card title="End of season">
        <p className="mb-3 text-sm text-secondary-600">
          Export a Scouting game year, then optionally reset the records and files you backed up.
        </p>
        <Link
          className={buttonClass("secondary")}
          to={preview ? "/preview/season" : "/admin/storage/seasons"}
        >
          Export and reset
        </Link>
      </Card>
      {error && <ErrorBanner message={error} />}
      {!apps && loading && <Loading />}
      {apps?.map((app) => (
        <div key={app.slug} className="space-y-6">
          {app.error && <ErrorBanner message={`${app.name}: ${app.error}`} />}
          {app.report?.allowances.map((allowance) => (
            <Allowance key={allowance.id} app={app.slug} allowance={allowance} preview={preview} />
          ))}
          {app.report && (
            <p className="text-xs text-secondary-500">
              {app.name} checked {date(app.report.checkedAt)}. Eligible dates are strictly before{" "}
              {date(app.report.cutoff)}.
            </p>
          )}
        </div>
      ))}
    </Page>
  );
}
