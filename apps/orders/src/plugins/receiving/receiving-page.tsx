import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { formatDate } from "../../shared/format";
import { Button, ErrorBanner, Loading, Page, SuccessBanner, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";

type Receiving = InferResponseType<typeof api.orders.receiving.$get, 200>;
type IncomingOrder = Receiving["open"][number];

/** The carrier's tracking page for a tracking number, guessed from its format. */
export function trackingUrl(tracking: string): { label: string; href: string } {
  const t = tracking.replace(/\s+/g, "");
  if (/^1Z[0-9A-Z]{16}$/i.test(t))
    return { label: "UPS", href: `https://www.ups.com/track?tracknum=${t}` };
  if (/^(9[2-5]\d{18,20}|82\d{8})$/.test(t)) {
    return { label: "USPS", href: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}` };
  }
  if (/^(\d{12}|\d{15}|\d{20})$/.test(t))
    return { label: "FedEx", href: `https://www.fedex.com/fedextrack/?trknbr=${t}` };
  return { label: "Track", href: `https://www.google.com/search?q=${encodeURIComponent(t)}` };
}

/**
 * Packages on the way, by vendor order: mark items received as they arrive. Mentors can receive
 * anything; everyone else, what they requested.
 */
export function ReceivingPage() {
  const { data, error, reload } = useLoad(async () => {
    const res = await api.orders.receiving.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [done, setDone] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  return (
    <Page title="Receiving">
      {error && <ErrorBanner message={error} />}
      {done && <SuccessBanner message={done} />}
      {!data ? (
        <Loading />
      ) : (
        <>
          {data.open.length === 0 ? (
            <p className="text-sm text-secondary-500">Nothing on the way right now.</p>
          ) : (
            data.open.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                onReceived={(message) => {
                  setDone(message);
                  reload();
                }}
              />
            ))
          )}
          {data.recent.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                className="text-sm font-semibold text-secondary-600 hover:text-secondary-900"
                onClick={() => setShowRecent((s) => !s)}
              >
                {showRecent ? "▾" : "▸"} Received in the last two weeks ({data.recent.length})
              </button>
              {showRecent &&
                data.recent.map((o) => <OrderCard key={o.id} order={o} onReceived={reload} />)}
            </div>
          )}
        </>
      )}
    </Page>
  );
}

function OrderCard({
  order: o,
  onReceived,
}: { order: IncomingOrder; onReceived: (message: string) => void }) {
  const user = useAuthUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTracking, setEditingTracking] = useState(false);
  const [tracking, setTracking] = useState(o.tracking ?? "");
  const canReceive = (line: IncomingOrder["lines"][number]) =>
    line.status === "ordered" && (user.isMentor || line.requesterId === user.userId);
  const receivable = o.lines.filter(canReceive);

  async function receive(ids: number[]) {
    setBusy(true);
    setError(null);
    const res = await api.orders.receive.$post({ json: { ids } });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    const { received } = await res.json();
    onReceived(
      `Received ${received.length} item${received.length === 1 ? "" : "s"} from ${o.vendor} order #${o.id}.`,
    );
  }

  async function saveTracking() {
    const res = await api.orders[":id"].tracking.$patch({
      param: { id: String(o.id) },
      json: { tracking: tracking.trim() || null },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    setEditingTracking(false);
    onReceived(`Saved tracking for ${o.vendor} order #${o.id}.`);
  }

  const track = o.tracking ? trackingUrl(o.tracking) : null;

  return (
    <section className="bg-white border border-secondary-200 rounded-xl overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 bg-secondary-50 border-b border-secondary-200">
        <h2
          className="min-w-0 max-w-full truncate font-semibold text-secondary-900"
          title={o.vendor}
        >
          {o.vendor}
        </h2>
        <p className="text-sm text-secondary-600 whitespace-nowrap">
          Order #{o.id} · placed {formatDate(o.placedAt)} by {o.placedByName}
        </p>
        <div className="flex items-center gap-2 text-sm">
          {editingTracking ? (
            <>
              <input
                className={`${inputClass} !w-56 !py-1`}
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                placeholder="Tracking number"
                aria-label="Tracking number"
              />
              <Button className="!py-1" onClick={saveTracking}>
                Save
              </Button>
            </>
          ) : track && o.tracking ? (
            <a
              href={track.href}
              target="_blank"
              rel="noreferrer"
              className="text-primary-600 hover:underline"
            >
              📦 {track.label} {o.tracking} ↗
            </a>
          ) : (
            <span className="text-secondary-400">No tracking</span>
          )}
          {user.isMentor && !editingTracking && (
            <button
              type="button"
              className="text-xs underline text-secondary-500"
              onClick={() => setEditingTracking(true)}
            >
              {o.tracking ? "Edit" : "Add"}
            </button>
          )}
        </div>
        {receivable.length > 1 && (
          <Button
            className="ml-auto !py-1.5"
            disabled={busy}
            onClick={() => receive(receivable.map((l) => l.id))}
          >
            Received all {receivable.length}
          </Button>
        )}
      </header>
      <ul className="divide-y divide-secondary-100">
        {o.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm">
            <span className="w-10 shrink-0 text-right font-semibold tabular-nums">
              {l.quantity}×
            </span>
            <div className="min-w-0 flex-1">
              <Link
                to={`/requests/${l.id}`}
                title={l.title}
                className="line-clamp-2 break-words text-secondary-900 hover:text-primary-500 font-medium"
              >
                {l.title}
              </Link>
              <p className="truncate text-xs text-secondary-500">
                {[l.variant, l.sku, `for ${l.requesterName}`].filter(Boolean).join(" · ")}
              </p>
            </div>
            {l.status === "received" ? (
              <span className="shrink-0 text-xs font-semibold text-emerald-700">
                ✓ Received{l.receivedAt ? ` ${formatDate(l.receivedAt)}` : ""}
                {l.receivedBy ? ` by ${l.receivedBy}` : ""}
              </span>
            ) : canReceive(l) ? (
              <Button className="shrink-0 !py-1" disabled={busy} onClick={() => receive([l.id])}>
                Received
              </Button>
            ) : (
              <span className="shrink-0 text-xs text-secondary-400">On the way</span>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <div className="px-4 pb-3">
          <ErrorBanner message={error} />
        </div>
      )}
    </section>
  );
}
