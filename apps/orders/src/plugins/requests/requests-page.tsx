import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { Deadline } from "../../shared/deadline";
import { formatCents, formatDate } from "../../shared/format";
import { PriorityBadge } from "../../shared/priority";
import { STATUS, StatusBadge } from "../../shared/status-badge";
import type { OrderRequest, RequestStatus } from "../../shared/types";
import { Card, ErrorBanner, Loading, Page } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { useVendors } from "../../shared/vendors";
import { ReplaceItem } from "./replace-item";
import { RequestActions } from "./request-actions";

const FILTERS: (RequestStatus | "all")[] = [
  "all",
  "requested",
  "approved",
  "ordered",
  "received",
  "denied",
  "cancelled",
];

async function loadRequests(status: RequestStatus | undefined, mine: boolean) {
  const res = await api.requests.$get({
    query: { ...(status ? { status } : {}), ...(mine ? { mine: "true" as const } : {}) },
  });
  if (!res.ok) throw new Error(await getErrorMessage(res));
  return res.json();
}

/** Everyone's requests, filterable by status and "only mine". */
export function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "all") as RequestStatus | "all";
  const mine = params.get("mine") === "true";
  const { data, error, reload } = useLoad(
    () => loadRequests(status === "all" ? undefined : status, mine),
    [status, mine],
  );

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  return (
    <Page title="Requests">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => update({ status: f === "all" ? null : f })}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${
              status === f
                ? "bg-secondary-900 text-white border-secondary-900"
                : "bg-white text-secondary-600 border-secondary-300 hover:border-secondary-500"
            }`}
          >
            {f === "all" ? "All" : STATUS[f].label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-secondary-700">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => update({ mine: e.target.checked ? "true" : null })}
          />
          Only mine
        </label>
      </div>
      {error && <ErrorBanner message={error} />}
      {!data ? <Loading /> : <RequestList requests={data} onChanged={reload} />}
    </Page>
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
                    <p className="text-sm text-secondary-700 line-clamp-3">“{r.reason}”</p>
                    <div className="pt-1 space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {r.url && (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-lg border border-secondary-300 bg-white px-3.5 py-2 text-sm font-semibold text-secondary-800 hover:bg-secondary-50"
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
