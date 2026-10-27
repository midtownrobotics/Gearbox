import {
  Button,
  ConfirmButton,
  ErrorBanner,
  Loading,
  Page,
  TextField,
  buttonClass,
  useAppOn,
  useTeamNames,
} from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { type DrawingState, drawingKey, drawingStates } from "../../shared/batches";
import { buildInstanceRows } from "../../shared/derive";
import { deleteDrawing, deleteDrawings, drawingUrl } from "../../shared/getters";
import {
  ProjectFilter,
  subsystemProjects,
  useDataInProject,
  useProjectFilter,
} from "../../shared/projects";
import { useAuthUser } from "../../shared/use-auth";
import { useKiosk } from "../../shared/use-auth";
import { useShopData } from "../../shared/use-shop-data";
import { PartNameLink, linkClass } from "../batches/batch-ui";
import { FileHeading, formatBytes } from "./file-ui";
import {
  PartFilesSection,
  SelectBox,
  SelectionBar,
  Subsection,
  useSelection,
} from "./part-files-section";

/** The drawing subsections, in the order the page shows them, with what each holds. */
const DRAWING_STATES: { state: DrawingState; title: string; empty: string }[] = [
  { state: "not-started", title: "Not Started", empty: "No drawing's part is waiting to start." },
  { state: "in-progress", title: "In Progress", empty: "No drawing's part is being made." },
  { state: "complete", title: "Complete", empty: "No drawing's part is complete yet." },
  { state: "obsolete", title: "Obsolete", empty: "No drawing is for an obsolete revision." },
];

type Drawing = {
  id: number;
  partNumber: string;
  revision: string;
  filename: string;
  r2Key: string;
  fileSize: number | null;
  uploadedBy: string | null;
  createdAt: number;
};

export function FilesPage() {
  const names = useTeamNames();
  const user = useAuthUser();
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [search, setSearch] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deletingMany, setDeletingMany] = useState(false);
  const selection = useSelection(drawings.map((d) => d.r2Key));
  const kiosk = useKiosk();
  const { data } = useShopData();
  const projectFilter = useProjectFilter();
  const projectId = projectFilter.projectId;
  const rows = useMemo(() => (data ? buildInstanceRows(data) : []), [data]);
  // The parts a batch can be started for: the chosen project's.
  const projectData = useDataInProject(data, projectId);
  const projectRows = useMemo(
    () => (projectData ? buildInstanceRows(projectData) : []),
    [projectData],
  );
  /** Whether a drawing is in the chosen project: its part's is, or no part is made from it. */
  const drawingInProject = useMemo(() => {
    const projectOf = subsystemProjects(data?.subsystems ?? []);
    return (d: Drawing) => {
      const part = data?.definitions.find((p) => p.onshapePartNumber === d.partNumber);
      return projectId === null || !part || projectOf.get(part.subsystemId) === projectId;
    };
  }, [data, projectId]);
  /** The part a drawing is of, when the shop has that revision. */
  const partOf = (d: Drawing) =>
    data?.definitions.find(
      (p) => p.onshapePartNumber === d.partNumber && p.revision === d.revision,
    );
  // Where each drawing's part is in production. One for a part nobody has made is not started.
  const states = useMemo(() => (data ? drawingStates(data) : new Map()), [data]);
  const stateOf = (d: Drawing): DrawingState =>
    states.get(drawingKey(d.partNumber, d.revision)) ?? "not-started";
  /** How many instances of a drawing's revision are still being made. */
  const stillMaking = (d: Drawing) =>
    rows.filter(
      (r) =>
        r.definition.onshapePartNumber === d.partNumber &&
        r.definition.revision === d.revision &&
        r.state !== "complete",
    ).length;

  async function handleDeleteDrawing(drawing: Drawing) {
    setDeletingKey(drawing.r2Key);
    try {
      await deleteDrawing(drawing.partNumber, drawing.revision);
      setDrawings((prev) => prev.filter((d) => d.r2Key !== drawing.r2Key));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete drawing");
    } finally {
      setDeletingKey(null);
    }
  }
  /** Deletes these drawings in one go. */
  async function handleDeleteDrawings(list: Drawing[]) {
    setDeletingMany(true);
    setError(null);
    try {
      await deleteDrawings(list.map((d) => ({ partNumber: d.partNumber, revision: d.revision })));
      const gone = new Set(list.map((d) => d.r2Key));
      setDrawings((prev) => prev.filter((d) => !gone.has(d.r2Key)));
      selection.set([...gone], false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete drawings");
    } finally {
      setDeletingMany(false);
    }
  }
  /** The question before deleting several drawings: how many instances still use them. */
  const deleteQuestion = (list: Drawing[]) => {
    const making = list.reduce((n, d) => n + stillMaking(d), 0);
    return `${
      making > 0
        ? `${making} instance${making === 1 ? " that's" : "s that are"} still being made use${making === 1 ? "s" : ""} them. `
        : ""
    }Delete ${list.length} drawing${list.length === 1 ? "" : "s"}? This can't be undone.`;
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<number | null>(null);
  // Printing goes through the team's edge box: no print buttons while Edge is off.
  const canPrint = useAppOn("edge") !== false;
  const [testPrinting, setTestPrinting] = useState(false);

  useEffect(() => {
    loadDrawings();
  }, []);

  async function loadDrawings() {
    try {
      setLoading(true);
      setError(null);
      const res = await api.drawings.$get();
      if (!res.ok) {
        setError(await getErrorMessage(res as unknown as Response));
        return;
      }
      const data = (await res.json()) as { drawings: Drawing[] };
      setDrawings(data.drawings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drawings");
    } finally {
      setLoading(false);
    }
  }

  async function handlePrint(drawing: Drawing) {
    setPrintingId(drawing.id);
    try {
      // The worker prints the stored drawing directly, so the PDF isn't
      // downloaded here and uploaded back over the shop's hotspot.
      const printRes = await api.print.drawing[":partNumber"][":revision"].$post({
        param: { partNumber: drawing.partNumber, revision: drawing.revision },
      });
      const printData = (await printRes.json()) as {
        ok: boolean;
        jobId?: string;
        error?: string;
        warning?: string | null;
      };
      if (!printData.ok) {
        setError(`Print failed: ${printData.error}`);
        return;
      }

      // Queued; mention a printer problem (out of paper, jam, ...) if there is one.
      if (printData.warning) setError(printData.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to print drawing");
    } finally {
      setPrintingId(null);
    }
  }

  async function handleTestPrint() {
    setTestPrinting(true);
    try {
      const testContent = `${names.name} Shop - Test Print\n\nIf you're seeing this, the printer is working!`;
      const encoder = new TextEncoder();
      const testBuffer = encoder.encode(testContent);

      const printRes = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? ""}/print?title=test-print`,
        {
          method: "POST",
          headers: {
            "content-type": "text/plain",
          },
          body: testBuffer,
          credentials: "include",
        },
      );

      const printData = (await printRes.json()) as {
        ok: boolean;
        jobId?: string;
        error?: string;
        warning?: string | null;
      };
      if (!printData.ok) {
        setError(`Test print failed: ${printData.error}`);
        return;
      }

      // Queued; show a printer problem (out of paper, jam, ...) if there is one.
      setError(printData.warning ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send test print");
    } finally {
      setTestPrinting(false);
    }
  }

  const visibleDrawings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = drawings
      .filter(drawingInProject)
      .sort(
        (a, b) => a.partNumber.localeCompare(b.partNumber) || a.revision.localeCompare(b.revision),
      );
    if (!q) return sorted;
    return sorted.filter(
      (d) => d.filename.toLowerCase().includes(q) || d.partNumber.toLowerCase().includes(q),
    );
  }, [drawings, search, drawingInProject]);

  if (loading)
    return (
      <Page title="Files" width="wide">
        <Loading />
      </Page>
    );

  const totalSize = drawings.reduce((sum, d) => sum + (d.fileSize || 0), 0);
  const chosen = drawings.filter((d) => selection.isChosen(d.r2Key));
  // Kiosks can't delete drawings, so they get no boxes.
  const canDelete = !kiosk.active;

  return (
    <Page
      title="Files"
      width="wide"
      actions={
        <>
          <ProjectFilter filter={projectFilter} />
          {user?.isAdmin && canPrint && (
            <Button variant="secondary" onClick={handleTestPrint} disabled={testPrinting}>
              {testPrinting ? "Testing…" : "Test print"}
            </Button>
          )}
        </>
      }
    >
      <>
        {error && <ErrorBanner message={error} />}

        <PartFilesSection data={data} rows={projectRows} projectId={projectId} />

        <section className="space-y-3 pt-4">
          <div>
            <h2 className="text-2xl text-secondary-900">Drawings</h2>
            <p className="text-xs text-secondary-500">
              {drawings.length} drawing{drawings.length === 1 ? "" : "s"} · {formatBytes(totalSize)}
            </p>
          </div>

          <TextField
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by filename or part number…"
          />

          <SelectionBar
            count={chosen.length}
            noun={["drawing", "drawings"]}
            question={deleteQuestion(chosen)}
            busy={deletingMany}
            onDelete={() => handleDeleteDrawings(chosen)}
            onClear={selection.clear}
          />

          {drawings.length === 0 ? (
            <p className="text-secondary-500 text-sm">
              No drawings yet. A release's drawings are saved when its parts are ingested.
            </p>
          ) : visibleDrawings.length === 0 ? (
            <p className="text-secondary-500 text-sm">No drawings match your search.</p>
          ) : (
            DRAWING_STATES.map(({ state, title, empty }) => {
              const list = visibleDrawings.filter((d) => stateOf(d) === state);
              // A search shows only the subsections that have a match.
              if (search.trim() && list.length === 0) return null;
              return (
                <Subsection
                  key={state}
                  title={title}
                  count={list.length}
                  empty={empty}
                  select={
                    // Only groups that are done with can all be chosen at once.
                    canDelete && (state === "complete" || state === "obsolete")
                      ? selection.group(list.map((d) => d.r2Key))
                      : undefined
                  }
                  deleteAll={
                    canDelete && (state === "complete" || state === "obsolete")
                      ? {
                          question: deleteQuestion(list),
                          busy: deletingMany,
                          onConfirm: () => handleDeleteDrawings(list),
                        }
                      : undefined
                  }
                >
                  {list.map((drawing) => {
                    const making = stillMaking(drawing);
                    const part = partOf(drawing);
                    return (
                      <li key={drawing.r2Key} className="flex gap-3 px-4 py-3">
                        {canDelete && (
                          <span className="pt-0.5">
                            <SelectBox
                              label={`Choose ${drawing.filename}`}
                              checked={selection.isChosen(drawing.r2Key)}
                              onChange={(on) => selection.set([drawing.r2Key], on)}
                            />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <FileHeading
                            name={
                              <a
                                href={drawingUrl(drawing.partNumber, drawing.revision)}
                                target="_blank"
                                rel="noreferrer"
                                title="Open this drawing"
                                className={linkClass}
                              >
                                {drawing.filename}
                              </a>
                            }
                            title={drawing.filename}
                            details={
                              <p className="text-xs text-secondary-400">
                                {part?.name && (
                                  <>
                                    <PartNameLink definition={part} />{" "}
                                  </>
                                )}
                                <span className="font-mono text-secondary-500">
                                  {drawing.partNumber} · Rev {drawing.revision}
                                </span>{" "}
                                · {formatBytes(drawing.fileSize || 0)} ·{" "}
                                {new Date(drawing.createdAt * 1000).toLocaleDateString()}
                              </p>
                            }
                          >
                            {canPrint && (
                              <Button
                                size="sm"
                                className="shrink-0"
                                onClick={() => handlePrint(drawing)}
                                disabled={printingId === drawing.id}
                              >
                                {printingId === drawing.id ? "Printing…" : "Print"}
                              </Button>
                            )}
                            <a
                              href={drawingUrl(drawing.partNumber, drawing.revision)}
                              download={drawing.filename}
                              className={`${buttonClass("secondary", "sm")} shrink-0`}
                            >
                              Download
                            </a>
                            {!kiosk.active && (
                              <ConfirmButton
                                size="sm"
                                label={deletingKey === drawing.r2Key ? "Deleting…" : "Delete"}
                                confirmLabel="Delete"
                                question={`${
                                  making > 0
                                    ? `${making} instance${making === 1 ? " that's" : "s that are"} still being made use${making === 1 ? "s" : ""} it. `
                                    : ""
                                }Delete the drawing for ${drawing.partNumber} Rev ${drawing.revision}? This can't be undone.`}
                                disabled={deletingKey === drawing.r2Key}
                                onConfirm={() => handleDeleteDrawing(drawing)}
                              />
                            )}
                          </FileHeading>
                        </div>
                      </li>
                    );
                  })}
                </Subsection>
              );
            })
          )}
        </section>
      </>
    </Page>
  );
}
