// SPDX-License-Identifier: AGPL-3.0-only
import {
  type SeasonExport,
  type SeasonPlan,
  type SeasonResetResult,
  verifySeasonBackup,
} from "@g3/auth/season-export";
import { apiPath } from "@g3/site-config";
import {
  Badge,
  Button,
  Card,
  Dialog,
  ErrorBanner,
  Field,
  Page,
  SuccessBanner,
  TextField,
  buttonClass,
  redirectToSignIn,
  tones,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platform } from "../../lib/platform";

const base = "/team/seasons/scouting";
const size = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
const previewPlan: SeasonPlan = import.meta.env.DEV
  ? {
      year: new Date().getFullYear(),
      notes: [],
      items: [
        {
          key: "reports",
          label: "Championship",
          kind: "Scouting reports",
          year: new Date().getFullYear(),
          records: 240,
          files: 120,
        },
        {
          key: "event",
          label: "Regional",
          kind: "Manual events",
          year: new Date().getFullYear(),
          records: 86,
          files: 0,
        },
        {
          key: "auto",
          label: "Center start",
          kind: "Auton routines",
          year: null,
          records: 1,
          files: 1,
        },
        {
          key: "robot",
          label: "Practice robot",
          kind: "Robot profiles",
          year: null,
          records: 4,
          files: 3,
        },
      ],
    }
  : { year: 0, notes: [], items: [] };

export function SeasonPage({ preview = false }: { preview?: boolean }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [plan, setPlan] = useState<SeasonPlan | null>(null);
  const [selected, setSelected] = useState(new Set<string>());
  const [job, setJob] = useState<SeasonExport | null>(null);
  const [existing, setExisting] = useState<{ id: string; year: number; expiresAt: number }[]>([]);
  const [verified, setVerified] = useState(new Set<number>());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [result, setResult] = useState<SeasonResetResult | null>(null);
  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    if (!preview)
      void platform<{ exports: typeof existing }>(`${base}/exports`)
        .then((data) => setExisting(data.exports))
        .catch((reason: Error) => setError(reason.message));
  }, [preview]);
  const review = () =>
    run("Reviewing season…", async () => {
      const next = preview
        ? {
            ...previewPlan,
            year: Number(year),
            items: previewPlan.items.map((item) => ({
              ...item,
              year: item.year === null ? null : Number(year),
            })),
          }
        : await platform<SeasonPlan>(`${base}?year=${encodeURIComponent(year)}`);
      setPlan(next);
      setSelected(
        new Set(next.items.filter((item) => item.year === next.year).map((item) => item.key)),
      );
      setPage(0);
      setQuery("");
      setSuccess("");
    });
  const start = () =>
    run("Preparing export…", async () => {
      if (!plan) return;
      const next = await platform<SeasonExport>(`${base}/exports`, {
        method: "POST",
        body: { year: plan.year, selection: [...selected] },
      });
      setJob(next);
      setVerified(new Set());
      setResult(null);
    });
  const download = (index: number) =>
    run(`Downloading part ${index + 1}…`, async () => {
      if (!job) return;
      const response = await fetch(
        `${apiPath("platform")}${base}/exports/${job.id}/${index}/archive`,
        { method: "POST", credentials: "include" },
      );
      if (response.status === 401) redirectToSignIn();
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { error?: string }).error ?? "Couldn't download the archive.",
        );
      const blob = await response.blob();
      const next = await platform<SeasonExport>(`${base}/exports/${job.id}`);
      const part = next.parts.find((part) => part.index === index);
      if (
        !part?.archiveHash ||
        !part.archiveSize ||
        !(await verifySeasonBackup(blob, part.archiveHash, part.archiveSize))
      )
        throw new Error("The download was incomplete. Try downloading this part again.");
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), {
        href: url,
        download: `scouting-${job.year}-part-${index + 1}.tar`,
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setJob(next);
      setVerified((previous) => {
        const copy = new Set(previous);
        copy.delete(index);
        return copy;
      });
    });
  const checkBackups = (files: FileList | null) =>
    run("Checking saved backups…", async () => {
      if (!files || !job) return;
      const checked = new Set(verified);
      for (const file of Array.from(files)) {
        let found = false;
        for (const part of job.parts) {
          if (!part.archiveHash || part.archiveSize !== file.size) continue;
          if (await verifySeasonBackup(file, part.archiveHash, part.archiveSize)) {
            checked.add(part.index);
            found = true;
            break;
          }
        }
        if (!found)
          throw new Error(
            `${file.name} does not match this export. Choose the complete .tar archives you downloaded.`,
          );
      }
      setVerified(checked);
    });
  const reset = () =>
    run("Resetting backed-up records…", async () => {
      if (
        !job ||
        confirmation !== `RESET ${job.year}` ||
        !job.parts.every((part) => verified.has(part.index))
      )
        return;
      setConfirmOpen(false);
      const total = { removed: 0, kept: 0, filesRemoved: 0 };
      try {
        for (const part of job.parts) {
          const next = await platform<SeasonResetResult>(
            `${base}/exports/${job.id}/${part.index}/reset`,
            { method: "POST", body: { archiveHash: part.archiveHash, confirmation } },
          );
          total.removed += next.removed;
          total.kept += next.kept;
          total.filesRemoved += next.filesRemoved;
        }
      } finally {
        setJob(await platform<SeasonExport>(`${base}/exports/${job.id}`));
      }
      setResult(total);
    });
  const discard = () =>
    run("Closing export…", async () => {
      if (!job) return;
      await platform(`${base}/exports/${job.id}`, { method: "DELETE" });
      setJob(null);
      setPlan(null);
      setVerified(new Set());
      setExisting([]);
      setResult(null);
      setDiscardOpen(false);
      setSuccess("Export closed. Keep your downloaded archives somewhere safe.");
    });
  const filtered =
    plan?.items.filter((item) =>
      `${item.label} ${item.kind}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const picked = plan?.items.filter((item) => selected.has(item.key)) ?? [];
  const allVerified = !!job && job.parts.every((part) => verified.has(part.index));
  return (
    <Page
      title="Export and reset"
      description="Keep a copy of a Scouting season before clearing its game data."
      actions={
        <Link
          className={buttonClass("secondary")}
          to={preview ? "/preview/storage" : "/admin/storage"}
        >
          Storage
        </Link>
      }
    >
      {preview && (
        <Card>
          <p className="text-sm text-amber-700">
            Local preview with sample data. Exports and resets are disabled.
          </p>
        </Card>
      )}
      {error && <ErrorBanner message={error} />}
      {success && <SuccessBanner message={success} />}
      {busy && (
        <p role="status" className="text-sm text-secondary-600">
          {busy}
        </p>
      )}
      <Card title="Choose the game year">
        <p className="mb-4 text-sm text-secondary-600">
          Accounts, settings, form templates and points history stay. Shop, Pit and other apps stay.
          Maps and drafts saved only on a device are not included.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Game year">
            <TextField
              typeable
              inputMode="numeric"
              pattern="[0-9]{4}"
              value={year}
              disabled={!!job || !!busy}
              onChange={(event) => {
                setYear(event.target.value);
                setPlan(null);
              }}
            />
          </Field>
          <Button
            variant="secondary"
            disabled={!!busy || !!job || !year}
            onClick={() => void review()}
          >
            Review season
          </Button>
        </div>
        {!job && existing.length > 0 && (
          <div className="mt-4 space-y-2">
            {existing.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span>{entry.year} export in progress</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!!busy}
                  onClick={() =>
                    void run("Opening export…", async () => {
                      const next = await platform<SeasonExport>(`${base}/exports/${entry.id}`);
                      setJob(next);
                      setYear(String(next.year));
                      setVerified(new Set());
                      setResult(null);
                    })
                  }
                >
                  Resume
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {plan && !job && (
        <Card title={`${plan.year} game data`}>
          <p className="mb-3 text-sm text-secondary-600">
            Records linked to this year's events are selected. Choose any items without a year that
            also belong to this game. Dates of upload do not determine the game year.
          </p>
          <TextField
            type="search"
            typeable
            aria-label="Find season data"
            placeholder="Find an event or item"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
          <div className="relative mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-secondary-500">
                <tr>
                  <th className="py-2 pr-3">Include</th>
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Year</th>
                  <th className="py-2">Contents</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((item) => (
                  <tr key={item.key}>
                    <td className="py-3 pr-3">
                      <input
                        type="checkbox"
                        aria-label={`Include ${item.kind}: ${item.label}`}
                        checked={selected.has(item.key)}
                        disabled={!!busy}
                        onChange={(event) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(item.key);
                            else next.delete(item.key);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="max-w-72 py-3 pr-3">
                      <span
                        className="block truncate font-medium text-secondary-900"
                        title={item.label}
                      >
                        {item.label}
                      </span>
                      <span className="text-secondary-500">{item.kind}</span>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3">
                      {item.year ?? "Choose manually"}
                    </td>
                    <td className="py-3">
                      {item.records.toLocaleString()} records · {item.files.toLocaleString()} files
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <p className="mt-4 text-sm text-secondary-600">No matching items.</p>
          )}
          {pageCount > 1 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
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
                  disabled={currentPage + 1 === pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
          <p className="mt-4 text-sm text-secondary-600">
            Selected: {picked.reduce((n, item) => n + item.records, 0).toLocaleString()} records.
            You can keep the export without resetting. Archives are for keeping a copy; automatic
            restore is not available.
          </p>
          <div className="mt-4">
            <Button
              disabled={preview || !!busy || !picked.length || existing.length > 0}
              onClick={() => void start()}
            >
              Prepare export
            </Button>
          </div>
        </Card>
      )}
      {job && (
        <Card title={`${job.year} season export`}>
          <p className="text-sm text-secondary-600">
            Download every part, then choose the saved .tar files to verify your backup before
            resetting. Keep the originals: resetting permanently removes the selected records and
            files, including recent ones.
          </p>
          <p className="mt-2 text-sm text-secondary-600">
            Finish by {new Date(job.expiresAt).toLocaleString()}. After that, start a new export. No
            data is removed when an export expires.
          </p>
          <div className="mt-4 space-y-3">
            {job.parts.map((part) => (
              <div
                key={part.index}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-secondary-900">Part {part.index + 1}</p>
                  <p className="text-sm text-secondary-600">
                    {part.records} records · {part.files} files · {size(part.bytes)} of files
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {part.result ? (
                    <Badge colors={tones.success}>Reset complete</Badge>
                  ) : verified.has(part.index) ? (
                    <Badge colors={tones.success}>Backup verified</Badge>
                  ) : (
                    <Badge colors={tones.neutral}>
                      {part.archiveHash ? "Verify saved file" : "Download first"}
                    </Badge>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!!busy || !!part.result}
                    onClick={() => void download(part.index)}
                  >
                    Download part {part.index + 1}
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {!result && (
            <div className="mt-4">
              <Field label="Verify saved archives">
                <input
                  type="file"
                  accept=".tar,application/x-tar"
                  multiple
                  disabled={!!busy}
                  onChange={(event) => {
                    const files = event.target.files;
                    void checkBackups(files);
                    event.target.value = "";
                  }}
                />
              </Field>
            </div>
          )}
          {result && (
            <div className="mt-4">
              <SuccessBanner
                message={`Removed ${result.removed} records and ${result.filesRemoved} files. Kept ${result.kept} records that changed or still have related data. Keep your archives.`}
              />
              <p className="mt-2 text-sm text-secondary-600">
                Review the season again for anything kept or added after this export. Files still
                used by another record and files outside your team's storage folder are kept.
              </p>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            {!result && (
              <Button
                variant="danger"
                disabled={!!busy || !allVerified}
                onClick={() => {
                  setConfirmation("");
                  setConfirmOpen(true);
                }}
              >
                Reset backed-up data
              </Button>
            )}
            <Button variant="secondary" disabled={!!busy} onClick={() => setDiscardOpen(true)}>
              {result ? "Done" : "Finish without reset"}
            </Button>
          </div>
        </Card>
      )}
      {confirmOpen && job && (
        <Dialog title={`Reset ${job.year} game data?`} onClose={() => setConfirmOpen(false)}>
          <p className="text-sm text-secondary-700">
            This permanently removes the selected records and their files. Changed records and other
            seasons stay. Your saved archives are your copy.
          </p>
          <div className="mt-4">
            <Field label={`Type RESET ${job.year} to continue`}>
              <TextField
                typeable
                autoComplete="off"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmation !== `RESET ${job.year}` || !allVerified || !!busy}
              onClick={() => void reset()}
            >
              Permanently reset
            </Button>
          </div>
        </Dialog>
      )}
      {discardOpen && (
        <Dialog
          title={result ? "Close this export?" : "Finish without resetting?"}
          onClose={() => setDiscardOpen(false)}
        >
          <p className="text-sm text-secondary-700">
            Keep any archives you downloaded. Closing this export clears its progress; you can start
            a new export later.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDiscardOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!!busy} onClick={() => void discard()}>
              Close export
            </Button>
          </div>
        </Dialog>
      )}
    </Page>
  );
}
