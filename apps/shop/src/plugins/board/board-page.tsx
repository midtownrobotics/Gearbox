import { Button, ErrorBanner, Loading, Page, inputClass } from "@g3/ui";
import { useEffect, useMemo, useState } from "react";
import { Link, matchPath, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../../shared/api";
import { getErrorMessage } from "../../shared/api-error";
import { batchAt, batchesById, currentBatch } from "../../shared/batches";
import {
  type InstanceRow,
  type ShopMood,
  buildInstanceRows,
  matchMachineProcess,
  partLabel,
  processLoads,
  shopMood,
} from "../../shared/derive";
import { fetchKioskPresence } from "../../shared/getters";
import { processPath } from "../../shared/nav";
import type { Batch, KioskPresence, ProcessType } from "../../shared/types";
import { useKiosk } from "../../shared/use-auth";
import { type ShopData, useShopData } from "../../shared/use-shop-data";
import { useTouchDevice } from "../../shared/use-touch";
import { useUserNames } from "../../shared/use-user-names";
import { BatchLink, useInstancePath } from "../batches/batch-ui";
import { PartCard } from "../parts/part-card";
import { ConsumerBatchCard, batchesHere } from "./consumer-process-view";
import { PartDetailsView } from "./part-details-view";
import { PartWorkView } from "./part-work-view";
import { ProducerSections } from "./producer-process-view";
import { ScanDialog } from "./scan-dialog";

const MOOD_TONES: Record<ShopMood["tone"], string> = {
  calm: "bg-emerald-50 border-emerald-300 text-emerald-800",
  steady: "bg-inset border-secondary-300 text-secondary-500",
  warn: "bg-amber-50 border-amber-300 text-amber-800",
  hot: "bg-red-50 border-red-300 text-red-800",
};

const LOAD_STYLES = {
  none: "bg-surface border-secondary-200",
  medium: "bg-amber-50 border-amber-300",
  high: "bg-red-50 border-red-300",
};

export function BoardPage() {
  const { data, loading, error, refresh } = useShopData();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const kiosk = useKiosk();
  // Kiosks are tablets — always use the finger-friendly layout there.
  const touch = useTouchDevice() || kiosk.active;

  // A kiosk named after a machine is locked to that machine's queue.
  const kioskMachine =
    kiosk.active && data ? matchMachineProcess(data.processes, kiosk.machineName) : null;
  // Parsed from the pathname, not useParams: kiosk mode renders no <Routes>.
  const urlProcessId = matchPath("/board/process/:processId", location.pathname)?.params.processId;
  const view: number | "overview" = kioskMachine
    ? kioskMachine.id
    : urlProcessId
      ? Number(urlProcessId)
      : "overview";

  const [banner, setBanner] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);
  const [workingPartInstanceId, setWorkingPartInstanceId] = useState<number | null>(null);
  const [viewingPartInstanceId, setViewingPartInstanceId] = useState<number | null>(null);
  const [presence, setPresence] = useState<KioskPresence[]>([]);
  const [scanOpen, setScanOpen] = useState(false);

  const rows = useMemo(() => (data ? buildInstanceRows(data) : []), [data]);
  const batchById = useMemo(() => batchesById(data?.batches ?? []), [data]);
  const loads = useMemo(() => (data ? processLoads(rows, data.processes) : []), [rows, data]);
  // What a scan is matched against: the station's own queue, or everything on the overview.
  const queueRows = useMemo(
    () =>
      view === "overview" ? rows : rows.filter((r) => r.procs.some((p) => p.processId === view)),
    [rows, view],
  );

  // A link to a part's details (`?instance=`, from its part number's page or a batch) opens its
  // card. The address is then put back as it was, so closing the card doesn't leave it to open
  // again.
  useEffect(() => {
    const instance = searchParams.get("instance");
    if (!instance) return;
    setSelectedInstanceId(Number(instance));
    const rest = new URLSearchParams(searchParams);
    rest.delete("instance");
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams]);

  // A link to a part's shop view (`?part=`, from its details view) opens it: the work view if it's
  // being worked on, else the one with Start Part. The address is then put back as it was, so
  // closing the view doesn't leave it to open again.
  useEffect(() => {
    const part = searchParams.get("part");
    if (!part || !data) return;
    const row = rows.find((r) => r.instance.id === Number(part));
    if (row?.state === "doing") setWorkingPartInstanceId(row.instance.id);
    else if (row) setViewingPartInstanceId(row.instance.id);
    const rest = new URLSearchParams(searchParams);
    rest.delete("part");
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams, data, rows]);

  // Who is logged in at each kiosk, refreshed alongside the heartbeat cadence.
  useEffect(() => {
    let canceled = false;
    const load = () =>
      fetchKioskPresence()
        .then((rows) => {
          if (!canceled) setPresence(rows);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 60 * 1000);
    return () => {
      canceled = true;
      clearInterval(id);
    };
  }, []);

  async function advance(row: InstanceRow, to: "doing" | "done") {
    if (!row.current) return;
    const res = await api["part-instance-processes"][":partInstanceId"].processes[":processId"][
      to
    ].$post({
      param: {
        partInstanceId: String(row.instance.id),
        processId: String(row.current.processId),
      },
    });
    if (!res.ok) {
      setBanner(await getErrorMessage(res as unknown as Response));
      return;
    }
    setBanner(null);
    await refresh();
    // Open the work view when starting a part
    if (to === "doing") {
      setWorkingPartInstanceId(row.instance.id);
    }
  }

  if (loading)
    return (
      <Page title="Shop Floor">
        <Loading />
      </Page>
    );

  const processName = (pid: number) =>
    data?.processes.find((p) => p.id === pid)?.name ?? `Process #${pid}`;

  const selectedRow =
    selectedInstanceId !== null
      ? (rows.find((r) => r.instance.id === selectedInstanceId) ?? null)
      : null;

  return (
    <Page
      title={kioskMachine?.name ?? (view === "overview" ? "Shop Floor" : processName(view))}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {view !== "overview" && !kioskMachine && (
            <Link
              to="/board"
              className={`text-sm text-secondary-500 hover:text-primary-600 ${touch ? "py-2" : ""}`}
            >
              ← Shop Floor
            </Link>
          )}
          {!kioskMachine && (
            <select
              aria-label="Machine"
              value={view === "overview" ? "overview" : String(view)}
              onChange={(e) =>
                navigate(
                  e.target.value === "overview" ? "/board" : processPath(Number(e.target.value)),
                )
              }
              className={`${inputClass} !w-auto`}
            >
              <option value="overview">Every machine</option>
              {data?.processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {kiosk.active && (
            <Button size="lg" className="shrink-0" onClick={() => setScanOpen(true)}>
              Scan
            </Button>
          )}
        </div>
      }
    >
      <>
        {error && <ErrorBanner message={error} />}
        {banner && <ErrorBanner message={banner} />}

        {view === "overview" && data ? (
          <OverviewView
            rows={rows}
            batchById={batchById}
            loads={loads}
            processName={processName}
            touch={touch}
            navigate={navigate}
            presence={presence}
          />
        ) : data ? (
          <ProcessView
            processId={view as number}
            rows={rows}
            data={data}
            batchById={batchById}
            processName={processName}
            onAdvance={advance}
            touch={touch}
            onOpenWorkView={setWorkingPartInstanceId}
            onViewPart={setViewingPartInstanceId}
            processType={data.processes.find((p) => p.id === view)?.type ?? "regular"}
            requiresPartInfo={!!data.processes.find((p) => p.id === view)?.requiresPartInfo}
            onChanged={refresh}
          />
        ) : null}

        {scanOpen && (
          <ScanDialog
            queue={queueRows}
            all={rows}
            onFound={(row) => {
              setScanOpen(false);
              // A part its batch moves has no buttons of its own: its batch's view has them.
              const batch = currentBatch(row, batchById);
              if (batch) {
                const next = new URLSearchParams(searchParams);
                next.set("batch", String(batch.id));
                setSearchParams(next);
              } else {
                setWorkingPartInstanceId(row.instance.id);
              }
            }}
            onClose={() => setScanOpen(false)}
          />
        )}

        {workingPartInstanceId &&
          data &&
          (() => {
            const workingRow = rows.find((r) => r.instance.id === workingPartInstanceId);
            return workingRow ? (
              <PartWorkView
                row={workingRow}
                data={data}
                onClose={() => setWorkingPartInstanceId(null)}
                onMarkComplete={async () => {
                  if (workingRow.current) {
                    await advance(workingRow, "done");
                    setWorkingPartInstanceId(null);
                  }
                }}
                onChanged={refresh}
              />
            ) : null;
          })()}

        {viewingPartInstanceId &&
          data &&
          (() => {
            const viewingRow = rows.find((r) => r.instance.id === viewingPartInstanceId);
            return viewingRow ? (
              <PartDetailsView
                row={viewingRow}
                data={data}
                onClose={() => setViewingPartInstanceId(null)}
                onStartPart={async () => {
                  if (viewingRow.current) {
                    await advance(viewingRow, "doing");
                  }
                }}
              />
            ) : null;
          })()}

        {selectedRow && data && (
          <PartCard
            row={selectedRow}
            data={data}
            onClose={() => setSelectedInstanceId(null)}
            onChanged={refresh}
          />
        )}
      </>
    </Page>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function getCookedness(totalQueue: number): string {
  if (totalQueue < 5) return "Mooing Cow 🐮";
  if (totalQueue < 10) return "Chopping Block 🔪";
  if (totalQueue < 20) return "Raw 🥩";
  if (totalQueue < 25) return "Rare 🍖";
  if (totalQueue < 35) return "Cooked 🍳";
  return "Ash 🔥";
}

function OverviewView({
  rows,
  batchById,
  loads,
  processName,
  touch,
  navigate,
  presence,
}: {
  rows: InstanceRow[];
  batchById: Map<number, Batch>;
  loads: ReturnType<typeof processLoads>;
  processName: (pid: number) => string;
  touch: boolean;
  navigate: (path: string) => void;
  presence: KioskPresence[];
}) {
  const mood = shopMood(loads);
  const inProgress = rows.filter((r) => r.state === "doing");
  const notStarted = sortPriorityFirst(rows.filter((r) => r.state === "todo"));
  const totalQueue = rows.length;
  const cookedness = getCookedness(totalQueue);

  const resolveName = useUserNames(presence.map((p) => p.userId));
  // Kiosks are matched to machines by name, same rule as the kiosk auto-open.
  const peopleAt = (processName: string) =>
    presence
      .filter((p) => p.deviceName.trim().toLowerCase() === processName.trim().toLowerCase())
      .map((p) => resolveName(p.userId));

  return (
    <div className="space-y-6">
      {/* Shop status */}
      <div className={`rounded-xl border px-5 py-4 ${MOOD_TONES[mood.tone]}`}>
        <p className="font-display text-3xl">{cookedness}</p>
        <p className="text-sm mt-0.5">{mood.blurb}</p>
      </div>

      {/* Process boxes */}
      {loads.length === 0 ? (
        <p className="text-secondary-400 text-sm">
          No processes defined yet — add some on the Admin page.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {loads.map((load) => (
            <Link
              key={load.process.id}
              to={processPath(load.process.id)}
              title={`${load.doing} in progress, ${load.todo} to do — click to open`}
              className={`rounded-xl border text-left transition-transform hover:-translate-y-0.5 ${LOAD_STYLES[load.level]} ${
                touch ? "p-5" : "p-4"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-secondary-900 truncate">
                  {load.process.name}
                </span>
                <span
                  title={load.doing > 0 ? "Running" : "Idle"}
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    load.doing > 0 ? "bg-emerald-500 animate-pulse" : "bg-secondary-300"
                  }`}
                />
              </div>
              <p className="text-xs text-secondary-500 mt-2">
                {load.doing} running · {load.todo} to do
              </p>
              {peopleAt(load.process.name).length > 0 && (
                <p
                  className="text-xs text-emerald-700 mt-1.5 truncate"
                  title={`At this machine: ${peopleAt(load.process.name).join(", ")}`}
                >
                  👤 {peopleAt(load.process.name).join(", ")}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Parts lists */}
      <BoardList
        title="In Progress"
        rows={inProgress}
        batchById={batchById}
        empty="Nothing is being worked on right now."
        processName={processName}
        touch={touch}
        navigate={navigate}
      />
      <BoardList
        title="Not Started"
        rows={notStarted}
        batchById={batchById}
        empty="Nothing is waiting to start."
        processName={processName}
        touch={touch}
        navigate={navigate}
      />
    </div>
  );
}

function BoardList({
  title,
  rows,
  batchById,
  empty,
  processName,
  touch,
  navigate,
}: {
  title: string;
  rows: InstanceRow[];
  batchById: Map<number, Batch>;
  empty: string;
  processName: (pid: number) => string;
  touch: boolean;
  navigate: (path: string) => void;
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
        {title} <span className="text-primary-600">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="text-secondary-400 text-sm">{empty}</p>
      ) : (
        <div className="bg-surface border border-secondary-200 rounded-xl divide-y divide-secondary-200">
          {rows.map((row) => (
            <PartLine
              key={row.instance.id}
              row={row}
              touch={touch}
              navigate={navigate}
              batch={currentBatch(row, batchById)}
              detailsLink
            >
              {row.current && (
                <Link
                  to={processPath(row.current.processId)}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-medium text-secondary-500 bg-inset border border-secondary-200 hover:border-secondary-400 hover:text-primary-600 rounded-full px-2.5 py-0.5 shrink-0 transition-colors"
                >
                  {processName(row.current.processId)}
                </Link>
              )}
            </PartLine>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Process view ──────────────────────────────────────────────────────────────

function ProcessView({
  processId,
  rows,
  data,
  batchById,
  processName,
  onAdvance,
  touch,
  onOpenWorkView,
  onViewPart,
  processType,
  requiresPartInfo,
  onChanged,
}: {
  processId: number;
  rows: InstanceRow[];
  data: ShopData;
  batchById: Map<number, Batch>;
  processName: (pid: number) => string;
  onAdvance: (row: InstanceRow, to: "doing" | "done") => Promise<void>;
  touch: boolean;
  onOpenWorkView: (instanceId: number) => void;
  onViewPart: (instanceId: number) => void;
  processType: ProcessType;
  requiresPartInfo: boolean;
  onChanged: () => Promise<void>;
}) {
  // Parts whose pipeline includes this process and haven't finished it yet.
  const here = rows.filter((r) => r.procs.some((p) => p.processId === processId));
  // A part its batch moves here isn't listed on its own: the batch is, as one unit.
  const alone = (status: "todo" | "doing") =>
    here.filter(
      (r) =>
        r.current?.processId === processId &&
        r.current.status === status &&
        !batchAt(r, processId, batchById),
    );
  const inProgress = alone("doing");
  const todo = sortPriorityFirst(alone("todo"));
  const batches =
    processType === "file_consumer"
      ? batchesHere(processId, data, new Map(here.map((r) => [r.instance.id, r])))
      : [];
  const batchesDoing = batches.filter((b) => b.batch.consumerStatus === "doing");
  const batchesTodo = batches.filter((b) => b.batch.consumerStatus === "todo");
  const inBatches = (list: typeof batches) => list.reduce((n, b) => n + b.live.length, 0);
  // Still stuck at an earlier process; the row at this process is "waiting".
  const upcoming = here.filter((r) =>
    r.procs.some((p) => p.processId === processId && p.status === "waiting"),
  );

  const btnSize = touch ? "px-4 py-2.5" : "px-3 py-1.5";
  const batchCards = (list: typeof batches) =>
    list.map((item) => (
      <ConsumerBatchCard key={item.batch.id} item={item} touch={touch} onChanged={onChanged} />
    ));

  return (
    <div className="space-y-6">
      {processType === "file_producer" ? (
        <ProducerSections
          processId={processId}
          rows={here}
          touch={touch}
          data={data}
          showPartInfo={requiresPartInfo}
          onChanged={onChanged}
          onAdvance={onAdvance}
          onOpenPart={(row) =>
            row.current?.status === "doing"
              ? onOpenWorkView(row.instance.id)
              : onViewPart(row.instance.id)
          }
        />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
              In Progress{" "}
              <span className="text-primary-600">
                {inProgress.length + inBatches(batchesDoing)}
              </span>
            </h2>
            {inProgress.length + batchesDoing.length === 0 ? (
              <p className="text-secondary-400 text-sm">Nothing in progress here.</p>
            ) : (
              <div className="bg-surface border border-secondary-200 rounded-xl divide-y divide-secondary-200">
                {batchCards(batchesDoing)}
                {inProgress.map((row) => (
                  <PartLine
                    key={row.instance.id}
                    row={row}
                    touch={touch}
                    onOpenPart={() => onOpenWorkView(row.instance.id)}
                    stack
                  >
                    <span className="relative group">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdvance(row, "done");
                        }}
                        className={`w-full whitespace-nowrap text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors ${btnSize}`}
                      >
                        Mark as complete
                      </button>
                      <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover:block whitespace-nowrap bg-secondary-900 text-surface text-xs rounded-md px-2.5 py-1.5 shadow-lg">
                        Do a quality check before marking this complete!
                      </span>
                    </span>
                  </PartLine>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
              To Do <span className="text-primary-600">{todo.length + inBatches(batchesTodo)}</span>
            </h2>
            {todo.length + batchesTodo.length === 0 ? (
              <p className="text-secondary-400 text-sm">Nothing ready to start.</p>
            ) : (
              <div className="bg-surface border border-secondary-200 rounded-xl divide-y divide-secondary-200">
                {batchCards(batchesTodo)}
                {todo.map((row) => (
                  <PartLine
                    key={row.instance.id}
                    row={row}
                    touch={touch}
                    onOpenPart={() => onViewPart(row.instance.id)}
                    stack
                  >
                    <Button
                      size={touch ? "md" : "sm"}
                      className="whitespace-nowrap"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAdvance(row, "doing");
                      }}
                    >
                      Start part
                    </Button>
                    <span className="relative group">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdvance(row, "done");
                        }}
                        className={`w-full whitespace-nowrap text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors ${btnSize}`}
                      >
                        Mark as complete
                      </button>
                      <span className="pointer-events-none absolute bottom-full right-0 mb-1.5 hidden group-hover:block whitespace-nowrap bg-secondary-900 text-surface text-xs rounded-md px-2.5 py-1.5 shadow-lg">
                        Do a quality check before marking this complete!
                      </span>
                    </span>
                  </PartLine>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <section className="space-y-2">
        <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-secondary-400">
          Upcoming <span className="text-primary-600">{upcoming.length}</span>
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-secondary-400 text-sm">Nothing else is headed this way.</p>
        ) : (
          <div className="bg-surface border border-secondary-200 rounded-xl divide-y divide-secondary-200">
            {upcoming.map((row) => (
              <PartLine
                key={row.instance.id}
                row={row}
                touch={touch}
                muted
                batch={batchAt(row, processId, batchById)}
                detailsLink
              >
                {row.current && (
                  <span className="text-xs text-secondary-400 shrink-0">
                    Stuck at{" "}
                    <Link
                      to={processPath(row.current.processId)}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-secondary-500 hover:text-primary-600 underline transition-colors"
                    >
                      {processName(row.current.processId)}
                    </Link>
                  </span>
                )}
              </PartLine>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

/**
 * One part in a list. With `onOpenPart` its name is the link that opens its shop view; with
 * `detailsLink` it opens the part's details instead. `batch` names the batch the part moves with,
 * which opens it. With `stack` its buttons (`children`) go on a row of their own under the name on
 * a narrow screen, where they'd otherwise leave no room for it.
 */
function PartLine({
  row,
  muted,
  touch,
  navigate,
  onOpenPart,
  detailsLink,
  batch,
  stack,
  children,
}: {
  row: InstanceRow;
  muted?: boolean;
  touch?: boolean;
  navigate?: (path: string) => void;
  onOpenPart?: () => void;
  detailsLink?: boolean;
  batch?: Batch | null;
  stack?: boolean;
  children?: React.ReactNode;
}) {
  const instancePath = useInstancePath();
  // On the overview, a row goes to the machine its part is at.
  const goToMachine = navigate && row.current ? navigate : null;
  const name = (
    <>
      {row.definition.name}
      <span className="text-secondary-400 font-normal ml-1.5">#{row.instance.instanceNumber}</span>
    </>
  );

  return (
    <div
      className={`relative px-4 ${
        stack
          ? "flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3"
          : "flex items-center gap-3"
      } ${goToMachine ? "cursor-pointer hover:bg-secondary-50 transition-colors" : ""} ${
        touch ? "py-4" : "py-2.5"
      }`}
      onClick={() => {
        if (goToMachine && row.current) goToMachine(processPath(row.current.processId));
      }}
      title={goToMachine ? "Go to machine" : undefined}
    >
      {row.instance.isPriority ? (
        <span className="absolute left-0 inset-y-0 w-1 bg-amber-400" title="Priority part" />
      ) : null}
      <div className={`min-w-0 ${stack ? "sm:flex-1" : "flex-1"}`}>
        {onOpenPart ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPart();
            }}
            title="Open this part"
            className={`block max-w-full truncate text-left text-sm font-medium text-primary-600 underline hover:text-primary-700 transition-colors ${
              touch ? "py-1" : ""
            }`}
          >
            {name}
          </button>
        ) : detailsLink ? (
          <Link
            to={instancePath(row.instance.id)}
            onClick={(e) => e.stopPropagation()}
            title="Open this part's details"
            className={`block max-w-full truncate text-sm font-medium text-primary-600 underline hover:text-primary-700 transition-colors ${
              touch ? "py-1" : ""
            }`}
          >
            {name}
          </Link>
        ) : (
          <p
            className={`text-sm font-medium truncate ${muted ? "text-secondary-500" : "text-secondary-900"}`}
          >
            {name}
          </p>
        )}
        <p className="text-xs font-mono text-secondary-400 truncate">
          {partLabel(row)}
          {batch && (
            <span className="font-sans">
              {" · in "}
              <BatchLink
                batch={batch}
                className="text-secondary-500 underline hover:text-primary-600 transition-colors"
              />
            </span>
          )}
        </p>
      </div>
      {stack ? (
        <div className="grid auto-cols-fr grid-flow-col gap-2 sm:flex sm:shrink-0 sm:items-center sm:gap-3">
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function sortPriorityFirst(rows: InstanceRow[]): InstanceRow[] {
  return [...rows].sort(
    (a, b) =>
      b.instance.isPriority - a.instance.isPriority ||
      a.definition.createdAt - b.definition.createdAt,
  );
}
