import { type ReactNode, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { Deadline } from "../../shared/deadline";
import { formatCents, formatDate } from "../../shared/format";
import { PriorityBadge } from "../../shared/priority";
import { StatusBadge } from "../../shared/status-badge";
import type { OrderRequest, RequestListRow, RequestStatus } from "../../shared/types";
import { Card, ErrorBanner, Loading, Page, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { useVendors } from "../../shared/vendors";
import { requestSearch } from "../lists/search";
import { ReplaceItem } from "./replace-item";
import { RequestActions } from "./request-actions";

// The requests table: one small row each, like the team's order sheet. Pending (awaiting
// approval) first, then approved, ordered and received (denied and canceled last); within each,
// your own first, then oldest first. A row opens the request's page.

type Group = "pending" | "approved" | "ordered" | "received" | "closed";

const GROUPS: { key: Group; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "ordered", label: "Ordered" },
  { key: "received", label: "Received" },
  { key: "closed", label: "Denied or canceled" },
];

// Wishlist items aren't listed here (the worker leaves them out); counted as pending if one were.
const groupOf = (status: RequestStatus): Group =>
  status === "requested" || status === "wishlist"
    ? "pending"
    : status === "denied" || status === "cancelled"
      ? "closed"
      : status;

const FILTERS: { key: Group | "all"; label: string }[] = [
  { key: "all", label: "All" },
  ...GROUPS.map((g) => ({ ...g, label: g.key === "closed" ? "Denied/canceled" : g.label })),
];

async function loadRequests(status: RequestStatus | undefined, mine: boolean) {
  const res = await api.requests.$get({
    query: { ...(status ? { status } : {}), ...(mine ? { mine: "true" as const } : {}) },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

/** What the line costs: what was paid once ordered, else the estimate. */
const lineCents = (r: OrderRequest) =>
  r.lineTotalCents ?? (r.unitPriceCents === null ? null : r.unitPriceCents * r.quantity);

/** Everyone's requests, filterable by status, "only mine" and a search. */
export function RequestsPage() {
  const user = useAuthUser();
  const [params, setParams] = useSearchParams();
  const raw = params.get("status");
  const filter = FILTERS.some((f) => f.key === raw) ? (raw as Group) : "all";
  const mine = params.get("mine") === "true";
  const query = params.get("q") ?? "";
  const { data, error } = useLoad(() => loadRequests(undefined, false), []);

  // The filters live in the address, so coming back from a request keeps them.
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const find = useMemo(() => requestSearch(data ?? []), [data]);
  const groups = useMemo(() => {
    const shown = find(query).filter(
      (r) =>
        (filter === "all" || groupOf(r.status) === filter) &&
        (!mine || r.requesterId === user.userId),
    );
    shown.sort(
      (a, b) =>
        Number(b.requesterId === user.userId) - Number(a.requesterId === user.userId) ||
        a.createdAt - b.createdAt ||
        a.id - b.id,
    );
    return GROUPS.map((g) => ({ ...g, rows: shown.filter((r) => groupOf(r.status) === g.key) }));
  }, [find, query, filter, mine, user.userId]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <Page title="Requests" wide>
      <div className="space-y-3">
        <input
          type="search"
          className={inputClass}
          placeholder="Search parts, SKUs, vendors, people…"
          value={query}
          onChange={(e) => update({ q: e.target.value })}
          aria-label="Search requests"
        />
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => update({ status: f.key === "all" ? null : f.key })}
              className={`rounded-full border px-3 py-1 text-sm font-medium ${
                filter === f.key
                  ? "bg-secondary-900 text-white border-secondary-900"
                  : "bg-surface text-secondary-600 border-secondary-300 hover:border-secondary-500"
              }`}
            >
              {f.label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-sm text-secondary-700">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => update({ mine: e.target.checked ? "true" : null })}
            />
            Only my requests
          </label>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {!data ? (
        <Loading />
      ) : total === 0 ? (
        <p className="text-sm text-secondary-500">
          {query || filter !== "all" || mine ? "No requests match." : "No requests here yet."}
        </p>
      ) : (
        <RequestTable sections={groups} userId={user.userId} />
      )}
    </Page>
  );
}

/**
 * The requests table (the Requests page; the Wishlist without its ordered and received columns):
 * a section per status, each with a header bar unless it has no label.
 */
export function RequestTable({
  sections,
  userId,
  wishlist = false,
  actions,
}: {
  sections: { key: string; label?: string; rows: RequestListRow[] }[];
  userId: string;
  /** Wishlist items: "added" instead of "requested", and never ordered or received. */
  wishlist?: boolean;
  /** Buttons at the end of each row (the wishlist's); on a phone, a line of their own. */
  actions?: (request: RequestListRow) => ReactNode;
}) {
  return (
    <div
      className={`grid ${wishlist ? (actions ? WISHLIST_ACTION_COLUMNS : WISHLIST_COLUMNS) : COLUMNS} overflow-hidden rounded-xl border border-secondary-200 bg-surface text-sm`}
    >
      <div
        className={`${ROW} bg-inset text-xs font-semibold uppercase tracking-wide text-secondary-500`}
      >
        <Cell className="col-span-2 md:col-span-1">Name</Cell>
        <Cell right>Qty</Cell>
        <Cell right>Price</Cell>
        <Cell line2 lineStart>
          Supplier
        </Cell>
        <Cell line2>{wishlist ? "Added by" : "Req by"}</Cell>
        <Cell line2 className="col-span-2 md:col-span-1">
          {wishlist ? "Added at" : "Req at"}
        </Cell>
        {!wishlist && <Cell className="hidden md:block">Ordered at</Cell>}
        {!wishlist && <Cell className="hidden md:block">Received at</Cell>}
        {actions && (
          <Cell className="hidden md:block">
            <span className="sr-only">Actions</span>
          </Cell>
        )}
      </div>
      {sections.map(
        (g) =>
          g.rows.length > 0 && (
            <section key={g.key} className="col-span-full grid grid-cols-subgrid">
              {g.label && (
                <h2 className="col-span-full bg-primary-600 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                  {g.label} · {g.rows.length}
                </h2>
              )}
              {g.rows.map((r) => (
                <RequestRow
                  key={r.id}
                  request={r}
                  mine={r.requesterId === userId}
                  wishlist={wishlist}
                  actions={actions}
                />
              ))}
            </section>
          ),
      )}
    </div>
  );
}

// One grid for the whole table, so every row's columns line up like the sheet's. Prices and dates
// are as wide as their widest value and never cut off; the name gives way first.
// Phone: two lines per request on four columns: Name (over Supplier and Req by) | Qty | Price,
// then Supplier | Req by | Req at (under Qty and Price). Ordered and received are left out.
const COLUMNS =
  "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_max-content_max-content] " +
  "md:grid-cols-[minmax(6rem,1fr)_max-content_max-content_minmax(4rem,max-content)_minmax(4rem,max-content)_max-content_max-content_max-content]";
/** The same without the ordered and received columns. */
const WISHLIST_COLUMNS =
  "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_max-content_max-content] " +
  "md:grid-cols-[minmax(6rem,1fr)_max-content_max-content_minmax(4rem,max-content)_minmax(4rem,max-content)_max-content]";
/** The wishlist's with a column for its buttons (a line of their own on a phone). */
const WISHLIST_ACTION_COLUMNS =
  "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_max-content_max-content] " +
  "md:grid-cols-[minmax(6rem,1fr)_max-content_max-content_minmax(4rem,max-content)_minmax(4rem,max-content)_max-content_max-content]";
/** A row of the table: its cells sit on the table's columns. */
const ROW = "col-span-full grid grid-cols-subgrid border-b border-secondary-200 last:border-b-0";

/**
 * One cell, with a separator on its left (but a line's first). Text that doesn't fit is cut
 * off with "…" unless `nowrap` (prices and dates, which the columns always fit).
 * `line2`: on a phone, it's on the request's second line.
 */
function Cell({
  children,
  right = false,
  center = false,
  line2 = false,
  lineStart = false,
  nowrap = false,
  title,
  className = "",
}: {
  children: ReactNode;
  right?: boolean;
  center?: boolean;
  line2?: boolean;
  /** On a phone, it starts the second line: no separator on its left there. */
  lineStart?: boolean;
  nowrap?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`min-w-0 border-secondary-200 px-2 py-1.5 ${
        lineStart ? "md:border-l" : "border-l first:border-l-0"
      } ${
        nowrap ? "whitespace-nowrap" : "truncate"
      } ${right ? "text-right" : center ? "text-center" : ""} ${
        line2 ? "border-t border-dashed md:border-t-0 md:border-solid text-xs md:text-sm" : ""
      } ${className}`}
    >
      {children}
    </span>
  );
}

const day = (ms: number | null) => (ms === null ? "—" : formatDate(ms));
/** A short date for a phone: 10/7/26. */
const shortDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });

/** When it was ordered or received (wide screens only; a phone leaves these columns out). */
function Done({ at }: { at: number | null }) {
  return (
    <Cell nowrap className="hidden tabular-nums md:block">
      {day(at)}
    </Cell>
  );
}

/**
 * One request as a row: two lines on a phone (every other request shaded, so each pair of lines
 * reads as one), the sheet's columns on a wide screen.
 */
function RequestRow({
  request: r,
  mine,
  wishlist,
  actions,
}: {
  request: RequestListRow;
  mine: boolean;
  wishlist: boolean;
  actions?: (request: RequestListRow) => ReactNode;
}) {
  const cents = lineCents(r);
  const estimate = r.orderId === null;
  const price = formatCents(cents, r.currency);
  return (
    <Link
      to={`/requests/${r.id}`}
      className={`${ROW} text-secondary-700 hover:bg-secondary-50 max-md:odd:bg-inset max-md:odd:hover:bg-secondary-100`}
    >
      <Cell title={r.title} className="col-span-2 font-medium text-secondary-900 md:col-span-1">
        {r.title}
      </Cell>
      <Cell right nowrap className="tabular-nums">
        {r.quantity}
      </Cell>
      <Cell
        right
        nowrap
        title={estimate ? `${price} (estimate)` : price}
        className={`tabular-nums ${estimate ? "text-secondary-500" : "text-secondary-900"}`}
      >
        {price}
      </Cell>
      <Cell line2 lineStart title={r.vendor} className="text-secondary-500 md:text-secondary-700">
        {r.vendor}
      </Cell>
      <Cell
        line2
        title={r.requesterName}
        className={
          mine ? "font-semibold text-secondary-900" : "text-secondary-500 md:text-secondary-700"
        }
      >
        {r.requesterName}
      </Cell>
      <Cell
        line2
        nowrap
        title={formatDate(r.createdAt)}
        className="col-span-2 tabular-nums md:col-span-1"
      >
        <span className="md:hidden">{shortDay(r.createdAt)}</span>
        <span className="hidden md:inline">{day(r.createdAt)}</span>
      </Cell>
      {!wishlist && <Done at={r.orderedAt} />}
      {!wishlist && <Done at={r.receivedAt} />}
      {actions && (
        // Buttons inside the row's link: a click on one does its job, not open the request.
        <span
          className="col-span-full flex justify-end gap-2 border-t border-dashed border-secondary-200 px-2 py-1.5 md:col-span-1 md:border-t-0 md:border-l md:border-solid md:py-1"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {actions(r)}
        </span>
      )}
    </Link>
  );
}

/** Mentors' queue: everything awaiting approval, with approve/deny right on each row. */
export function ApprovalsPage() {
  const { data, error, reload } = useLoad(() => loadRequests("requested", false), []);
  return (
    <Page title="Approvals">
      {error && <ErrorBanner message={error} />}
      {!data ? (
        <Loading />
      ) : (
        <RequestList
          requests={data}
          onChanged={reload}
          showActions
          empty="Nothing waiting for approval."
        />
      )}
    </Page>
  );
}

export function RequestList({
  requests,
  onChanged,
  showActions = false,
  empty = "No requests here yet.",
  extra,
}: {
  requests: OrderRequest[];
  onChanged: () => void;
  showActions?: boolean;
  empty?: string;
  /** More for each row (a list's "Remove" button), under its details. */
  extra?: (request: OrderRequest) => ReactNode;
}) {
  const { vendorFor } = useVendors();
  if (requests.length === 0) return <p className="text-sm text-secondary-500">{empty}</p>;
  return (
    <div className="space-y-2">
      {requests.map((r) => {
        const estimate = r.unitPriceCents === null ? null : r.unitPriceCents * r.quantity;
        return (
          <Card key={r.id} className="!p-4">
            <div className="flex gap-4">
              {r.image ? (
                <img
                  src={r.image}
                  alt=""
                  className="w-16 h-16 object-contain rounded-md bg-secondary-50 shrink-0"
                />
              ) : (
                <div className="w-16 h-16 rounded-md bg-secondary-100 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    to={`/requests/${r.id}`}
                    className="font-semibold text-secondary-900 hover:text-primary-500 line-clamp-2"
                  >
                    {r.quantity}× {r.title}
                  </Link>
                  <span className="flex flex-wrap gap-1.5">
                    <PriorityBadge priority={r.priority} />
                    <StatusBadge status={r.status} />
                  </span>
                </div>
                <p className="text-sm text-secondary-600">
                  {r.vendor}
                  {r.variant && ` · ${r.variant}`} · {r.categoryName} ·{" "}
                  <span className="tabular-nums">
                    {estimate === null
                      ? "price unknown"
                      : `${formatCents(estimate, r.currency)}${r.orderId === null ? " est." : ""}`}
                  </span>
                </p>
                <p className="text-xs text-secondary-500">
                  {r.requesterName} · {formatDate(r.createdAt)}
                  {r.needBy !== null && (
                    <>
                      {" · "}
                      <Deadline request={r} vendor={vendorFor(r.vendor)} />
                    </>
                  )}
                </p>
                {extra?.(r)}
                {showActions && (
                  <>
                    {r.reason && (
                      <p className="text-sm text-secondary-700 line-clamp-3">“{r.reason}”</p>
                    )}
                    <div className="pt-1 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {r.url && (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-secondary-300 bg-surface px-3.5 py-2 text-sm font-semibold text-secondary-800 hover:bg-secondary-50"
                          >
                            Open link ↗
                          </a>
                        )}
                        {r.status === "requested" && (
                          <ReplaceItem request={r} onReplaced={onChanged} />
                        )}
                      </div>
                      {/* Keyed by the last edit so a replaced item's quantity and price show here. */}
                      <RequestActions key={r.updatedAt} request={r} onChanged={onChanged} compact />
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
