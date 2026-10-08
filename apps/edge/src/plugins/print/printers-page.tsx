import { useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { Card, ErrorBanner, Loading, Page } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { PrinterAlerts } from "./alerts";
import {
  type PrinterRow,
  alertsFor,
  input,
  loadPrinters,
  networkError,
  plainButton,
  primaryButton,
  printerStatus,
} from "./shared";

type Discovered = {
  uri: string;
  info: string | null;
  makeAndModel: string | null;
  location: string | null;
  addedAs: string | null;
};

/** A CUPS queue name from a printer's description: "Brother HL-L2350DW series" → "Brother_HL-L2350DW_series". */
function queueName(text: string) {
  return (
    text
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "Printer"
  );
}

export function PrintersPage() {
  const user = useAuthUser();
  const { data, error, reload } = useLoad(loadPrinters, []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(
    key: string,
    fn: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  ) {
    setBusy(key);
    try {
      const res = await fn();
      setActionError(res.ok ? null : await getErrorMessage(res));
    } catch (err) {
      setActionError(networkError(err));
    } finally {
      setBusy(null);
      reload();
    }
  }

  return (
    <Page title="Printers">
      {actionError && <ErrorBanner message={actionError} />}
      {error ? (
        <ErrorBanner message={error} />
      ) : !data ? (
        <Loading />
      ) : (
        <Card>
          {data.length === 0 ? (
            <p className="text-sm text-secondary-400">No printers are set up on the edge box.</p>
          ) : (
            <ul className="divide-y divide-secondary-100">
              {data.map((p) => (
                <PrinterItem
                  key={p.name}
                  printer={p}
                  isAdmin={user.isAdmin}
                  busy={busy}
                  act={act}
                />
              ))}
            </ul>
          )}
        </Card>
      )}
      {user.isAdmin && data && <AddPrinter onAdded={reload} existing={data} />}
    </Page>
  );
}

function PrinterItem({
  printer: p,
  isAdmin,
  busy,
  act,
}: {
  printer: PrinterRow;
  isAdmin: boolean;
  busy: string | null;
  act: (
    key: string,
    fn: () => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  ) => Promise<void>;
}) {
  const status = printerStatus(p);
  const alerts = alertsFor(p);
  const param = { param: { name: p.name } };
  const printerApi = api.print.printers[":name"];
  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-secondary-900">{p.description ?? p.name}</span>
        {p.isDefault && (
          <span className="text-xs font-bold uppercase tracking-widest text-primary-500">
            Default
          </span>
        )}
        <span className="flex items-center gap-1.5 text-sm text-secondary-500">
          <span className={`w-2 h-2 rounded-full ${status.dot}`} aria-hidden />
          {status.label}
        </span>
      </div>
      <p className="text-xs text-secondary-400">
        {[p.makeAndModel, p.location, p.name].filter(Boolean).join(" · ")}
      </p>
      <PrinterAlerts alerts={alerts} />
      {p.stateMessage && (
        <p className="text-xs text-secondary-500">Printer says: {p.stateMessage}</p>
      )}
      {p.markers.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {p.markers.map((m) => (
            <div key={m.name} className="flex items-center gap-2 text-xs text-secondary-500">
              <span>{m.name}</span>
              <div className="w-20 h-1.5 rounded-full bg-secondary-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(0, m.level)}%`,
                    background: m.color?.startsWith("#") ? m.color : undefined,
                  }}
                />
              </div>
              <span>{m.level >= 0 ? `${m.level}%` : "?"}</span>
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <div className="flex flex-wrap gap-1">
          {!p.isDefault && (
            <button
              type="button"
              className={plainButton}
              disabled={busy !== null}
              onClick={() =>
                act(`default-${p.name}`, () =>
                  printerApi[":action{default|resume|test}"].$post({
                    param: { name: p.name, action: "default" },
                  }),
                )
              }
            >
              Make default
            </button>
          )}
          <button
            type="button"
            className={plainButton}
            disabled={busy !== null}
            onClick={() =>
              act(`test-${p.name}`, () =>
                printerApi[":action{default|resume|test}"].$post({
                  param: { name: p.name, action: "test" },
                }),
              )
            }
          >
            {busy === `test-${p.name}` ? "Sending…" : "Print test page"}
          </button>
          {(p.state === "stopped" || !p.acceptingJobs) && (
            <button
              type="button"
              className={plainButton}
              disabled={busy !== null}
              onClick={() =>
                act(`resume-${p.name}`, () =>
                  printerApi[":action{default|resume|test}"].$post({
                    param: { name: p.name, action: "resume" },
                  }),
                )
              }
            >
              Resume
            </button>
          )}
          <button
            type="button"
            className={`${plainButton} text-primary-600`}
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm(`Remove ${p.description ?? p.name} from the edge box?`)) {
                void act(`remove-${p.name}`, () => printerApi.$delete(param));
              }
            }}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

/** Admin: find printers on the shop network, or add one by address. */
function AddPrinter({ onAdded, existing }: { onAdded: () => void; existing: PrinterRow[] }) {
  const [found, setFound] = useState<Discovered[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");

  async function discover() {
    setSearching(true);
    setError(null);
    try {
      const res = await api.print.discover.$post();
      if (res.ok) setFound((await res.json()).printers);
      else setError(await getErrorMessage(res));
    } catch (err) {
      setError(networkError(err));
    } finally {
      setSearching(false);
    }
  }

  async function add(uri: string, label: string) {
    setAdding(uri);
    setError(null);
    let res: Awaited<ReturnType<typeof api.print.printers.$post>>;
    try {
      res = await api.print.printers.$post({
        json: {
          name: queueName(label),
          uri,
          description: label,
          makeDefault: existing.length === 0,
        },
      });
    } catch (err) {
      setError(networkError(err));
      return;
    } finally {
      setAdding(null);
    }
    if (!res.ok) {
      setError(await getErrorMessage(res));
      return;
    }
    setFound(
      (f) => f?.map((d) => (d.uri === uri ? { ...d, addedAs: queueName(label) } : d)) ?? null,
    );
    setAddress("");
    onAdded();
  }

  // Accepts an IP/hostname or a full ipp://, ipps://, or socket:// URI.
  const manualUri = address.includes("://")
    ? address.trim()
    : address.trim()
      ? `ipp://${address.trim()}/ipp/print`
      : "";

  return (
    <Card title="Add a printer">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={primaryButton} onClick={discover} disabled={searching}>
            {searching ? "Searching the shop network…" : "Find printers"}
          </button>
          <span className="text-sm text-secondary-500">
            Looks for printers on the shop network. Takes about 10 seconds.
          </span>
        </div>
        {found &&
          (found.length === 0 ? (
            <p className="text-sm text-secondary-400">
              No printers found. Check the printer is on and connected to the shop network, or add
              it by address below.
            </p>
          ) : (
            <ul className="divide-y divide-secondary-100 border border-secondary-200 rounded-lg">
              {found.map((d) => {
                const label = d.info ?? d.makeAndModel ?? d.uri;
                return (
                  <li key={d.uri} className="px-3 py-2 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-secondary-900 truncate">{label}</p>
                      <p className="text-xs text-secondary-400 truncate">
                        {d.uri.replace(/\?.*$/, "")}
                      </p>
                    </div>
                    {d.addedAs ? (
                      <span className="text-sm text-secondary-400">Added</span>
                    ) : (
                      <button
                        type="button"
                        className={primaryButton}
                        disabled={adding !== null}
                        onClick={() => add(d.uri, label)}
                      >
                        {adding === d.uri ? "Setting up…" : "Add"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ))}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manualUri) void add(manualUri, address.trim());
          }}
        >
          <span className="text-sm text-secondary-600">Or by address:</span>
          <input
            className={`${input} w-64`}
            value={address}
            placeholder="192.168.50.140 or ipp://…"
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit" className={plainButton} disabled={!manualUri || adding !== null}>
            {adding === manualUri ? "Setting up…" : "Add"}
          </button>
        </form>
        <p className="text-xs text-secondary-400">Setting up a printer can take up to a minute.</p>
        {error && <ErrorBanner message={error} />}
      </div>
    </Card>
  );
}
