import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { Deadline } from "../../shared/deadline";
import {
  dateInputToMs,
  formatCents,
  formatDateTime,
  msToDateInput,
  parseDollars,
} from "../../shared/format";
import { PRIORITY, PRIORITY_ORDER, PriorityBadge } from "../../shared/priority";
import { STATUS, StatusBadge } from "../../shared/status-badge";
import type { Priority, RequestDetail, RequestStatus } from "../../shared/types";
import { Button, Card, ErrorBanner, Field, Loading, Page, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { useVendors } from "../../shared/vendors";
import { RequestLists } from "../lists/request-lists";
import { RequestActions } from "./request-actions";

const EVENT_LABELS: Record<string, string> = {
  created: "Requested",
  edited: "Edited",
  replaced: "Replaced item",
};

export function RequestDetailPage() {
  const { id = "" } = useParams();
  const user = useAuthUser();
  const { vendorFor } = useVendors();
  const [editing, setEditing] = useState(false);
  const { data, error, reload } = useLoad(async () => {
    const res = await api.requests[":id"].$get({ param: { id } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [id]);

  if (error) {
    return (
      <Page title="Request">
        <ErrorBanner message={error} />
      </Page>
    );
  }
  if (!data) {
    return (
      <Page title="Request">
        <Loading />
      </Page>
    );
  }

  const r = data;
  const estimate = r.unitPriceCents === null ? null : r.unitPriceCents * r.quantity;
  const canEdit = r.status === "requested" && (user.isMentor || r.requesterId === user.userId);

  return (
    <Page
      title={`Request #${r.id}`}
      actions={
        <Link to="/requests" className="text-sm text-secondary-500 hover:text-secondary-800">
          ← All requests
        </Link>
      }
    >
      <Card>
        <div className="flex flex-col md:flex-row gap-6">
          {r.image && (
            <img
              src={r.image}
              alt=""
              className="w-full md:w-48 h-48 object-contain rounded-lg bg-secondary-50 shrink-0"
            />
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="text-xl font-semibold text-secondary-900 hover:text-primary-500"
              >
                {r.title} ↗
              </a>
              <span className="flex flex-wrap gap-1.5">
                <PriorityBadge priority={r.priority} />
                <StatusBadge status={r.status} />
              </span>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <Row label="Vendor">{r.vendor}</Row>
              {r.variant && <Row label="Option">{r.variant}</Row>}
              {r.sku && (
                <Row label="SKU">
                  <span className="font-mono">{r.sku}</span>
                </Row>
              )}
              <Row label="Quantity">{r.quantity}</Row>
              <Row label="Price each">{formatCents(r.unitPriceCents, r.currency)}</Row>
              <Row label={r.orderId === null ? "Estimated total" : "Ordered total"}>
                {formatCents(estimate, r.currency)}
              </Row>
              {r.orderId !== null && <Row label="Vendor order">#{r.orderId}</Row>}
              <Row label="Budget">{r.categoryName}</Row>
              <Row label="Priority">{PRIORITY[r.priority].label}</Row>
              {r.needBy !== null && (
                <Row label="Deadline">
                  <Deadline request={r} vendor={vendorFor(r.vendor)} />
                </Row>
              )}
              <Row label="Requested by">{r.requesterName}</Row>
            </dl>
            <div>
              <p className="text-sm font-medium text-secondary-700">Why</p>
              <p className="text-sm text-secondary-800 whitespace-pre-wrap">{r.reason}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          <RequestActions request={r} onChanged={reload} />
          {canEdit && !editing && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit request
            </Button>
          )}
        </div>
      </Card>

      <RequestLists requestId={r.id} />

      {editing && (
        <EditForm
          request={r}
          onDone={() => {
            setEditing(false);
            reload();
          }}
        />
      )}

      <Card title="History">
        <ol className="space-y-3">
          {r.events.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="text-secondary-400 tabular-nums whitespace-nowrap w-32 shrink-0">
                {formatDateTime(e.createdAt)}
              </span>
              <div>
                <p className="text-secondary-900">
                  <span className="font-semibold">
                    {EVENT_LABELS[e.action] ?? STATUS[e.action as RequestStatus]?.label ?? e.action}
                  </span>{" "}
                  by {e.userName}
                </p>
                {e.note && <p className="text-secondary-600 whitespace-pre-wrap">“{e.note}”</p>}
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-secondary-500">{label}</dt>
      <dd className="text-secondary-900">{children}</dd>
    </>
  );
}

function EditForm({ request, onDone }: { request: RequestDetail; onDone: () => void }) {
  const categories = useLoad(async () => {
    const res = await api.categories.$get({ query: {} });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).filter((c) => !c.isArchived || c.id === request.categoryId);
  }, []);
  const [quantity, setQuantity] = useState(String(request.quantity));
  const [price, setPrice] = useState(
    request.unitPriceCents === null ? "" : (request.unitPriceCents / 100).toFixed(2),
  );
  const [categoryId, setCategoryId] = useState(String(request.categoryId));
  const [reason, setReason] = useState(request.reason);
  const [priority, setPriority] = useState<Priority>(request.priority);
  const [needBy, setNeedBy] = useState(msToDateInput(request.needBy));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const unitPriceCents = parseDollars(price);
    if (Number.isNaN(unitPriceCents)) return setError("Price must be a dollar amount like 12.50.");
    setBusy(true);
    const res = await api.requests[":id"].$patch({
      param: { id: String(request.id) },
      json: {
        quantity: Number(quantity),
        unitPriceCents,
        categoryId: Number(categoryId),
        reason,
        priority,
        needBy: dateInputToMs(needBy),
      },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    onDone();
  }

  return (
    <form onSubmit={save}>
      <Card title="Edit request">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Quantity">
            <input
              type="number"
              min={1}
              max={10000}
              className={inputClass}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </Field>
          <Field label="Price each">
            <input
              className={inputClass}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </Field>
          <Field label="Budget category">
            <select
              className={inputClass}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              className={inputClass}
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY[p].label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Need by">
            <input
              type="date"
              className={inputClass}
              value={needBy}
              onChange={(e) => setNeedBy(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-3">
            <Field label="Why do we need it?">
              <textarea
                className={`${inputClass} min-h-20`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                maxLength={1000}
              />
            </Field>
          </div>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}
