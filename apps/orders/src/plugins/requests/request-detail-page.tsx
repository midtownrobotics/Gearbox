import {
  Button,
  Card,
  ConfirmButton,
  ErrorBanner,
  Field,
  Loading,
  Page,
  TextField,
  inputClass,
} from "@g3/ui";
import { type FormEvent, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { ConfirmDialog } from "../../shared/ask";
import { useAuthUser } from "../../shared/auth";
import { Deadline } from "../../shared/deadline";
import {
  dateInputToMs,
  formatCents,
  formatDateTime,
  msToDateInput,
  parseDollars,
} from "../../shared/format";
import { PackInput, amountOf, packHint, packLabel } from "../../shared/pack";
import { PRIORITY, PRIORITY_ORDER, PriorityBadge } from "../../shared/priority";
import { QuantityInput, parseQuantity, quantityError } from "../../shared/quantity";
import { STATUS, StatusBadge } from "../../shared/status-badge";
import type { Priority, RequestDetail, RequestStatus } from "../../shared/types";
import { useLoad } from "../../shared/use-load";
import { useVendors } from "../../shared/vendors";
import { RequestLists } from "../lists/request-lists";
import { VendorCart } from "../ordering/ordering-page";
import { type Draft, lookUpDraft } from "./draft";
import { RequestActions } from "./request-actions";
import { promote, removeWish } from "./wishlist-page";

const EVENT_LABELS: Record<string, string> = {
  created: "Requested",
  edited: "Edited",
  replaced: "Replaced item",
  reapproved: "Re-approved",
};

export function RequestDetailPage() {
  const { id = "" } = useParams();
  const user = useAuthUser();
  const { vendorFor } = useVendors();
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  // Back to where the request was opened from (a list, Approvals, a filtered search); straight
  // to Requests when the page was opened directly (a link in a chat message, a new tab).
  const cameFromApp = useLocation().key !== "default";
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Promoting a wishlist item asks first, in a pop-up.
  const [promoting, setPromoting] = useState(false);
  const { data, error, reload } = useLoad(async () => {
    const res = await api.requests[":id"].$get({ param: { id } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [id]);
  const wished = data?.status === "wishlist";
  const back = (
    <button
      type="button"
      onClick={() => (cameFromApp ? navigate(-1) : navigate(wished ? "/wishlist" : "/requests"))}
      className="text-sm text-secondary-500 hover:text-secondary-800"
    >
      ← {cameFromApp ? "Back" : wished ? "Wishlist" : "All requests"}
    </button>
  );

  /** Wishlist: promote it to a request (by this member) or remove it. Anyone can. */
  async function wishAction(action: "promote" | "remove") {
    setPromoting(false);
    setBusy(true);
    setActionError(null);
    try {
      if (action === "promote") {
        await promote(Number(id));
        reload();
      } else {
        await removeWish(Number(id));
        navigate("/wishlist", { replace: true });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
  // A wishlist item: anyone. A request: its requester or a mentor while it's waiting, and a
  // mentor once it's approved, until it's ordered.
  const canEdit =
    wished ||
    (r.status === "requested" && (user.isMentor || r.requesterId === user.userId)) ||
    (r.status === "approved" && user.isMentor);
  // On the same line as the page's other buttons, where there's room.
  const editButton = canEdit && !editing && (
    <Button variant="secondary" onClick={() => setEditing(true)}>
      Edit request
    </Button>
  );

  return (
    <Page title={wished ? `Wishlist #${r.id}` : `Request #${r.id}`} actions={back}>
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
                className="min-w-0 text-xl font-semibold text-secondary-900 hover:text-primary-500 [overflow-wrap:anywhere]"
              >
                {r.title} ↗
              </a>
              <span className="flex flex-wrap gap-1.5">
                <PriorityBadge priority={r.priority} />
                <StatusBadge status={r.status} />
              </span>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
              <Row label="Vendor">{r.vendor}</Row>
              {r.variant && <Row label="Option">{r.variant}</Row>}
              {r.sku && (
                <Row label="SKU">
                  <span className="font-mono">{r.sku}</span>
                </Row>
              )}
              <Row label="Quantity">
                {r.quantity}
                {packLabel(r.packQuantity, r.packUnit) &&
                  ` × ${packLabel(r.packQuantity, r.packUnit)} (${amountOf(r.quantity * r.packQuantity, r.packUnit)})`}
              </Row>
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
              <Row label={wished ? "Added by" : "Requested by"}>{r.requesterName}</Row>
            </dl>
            {r.reason && (
              <div>
                <p className="text-sm font-medium text-secondary-700">Why</p>
                <p className="text-sm text-secondary-800 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {r.reason}
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {actionError && <ErrorBanner message={actionError} />}
          {wished && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => setPromoting(true)}>
                Promote to request
              </Button>
              {editButton}
              <ConfirmButton
                label="Remove from wishlist"
                confirmLabel="Remove it"
                question={`Remove ${r.title} from the wishlist?`}
                disabled={busy}
                onConfirm={() => void wishAction("remove")}
              />
              {promoting && (
                <ConfirmDialog
                  title="Promote to a request"
                  confirmLabel="Request it"
                  onConfirm={() => void wishAction("promote")}
                  onClose={() => setPromoting(false)}
                >
                  Request {r.title}? It goes to the mentors as your request.
                </ConfirmDialog>
              )}
            </div>
          )}
          {/* Keyed so its quantity and price boxes follow an edit. */}
          <RequestActions
            key={r.updatedAt}
            request={r}
            onChanged={reload}
            extra={wished ? undefined : editButton}
          />
        </div>
      </Card>

      {/* Approved: its vendor's whole cart, to place it from here (mentors place orders). Keyed so
          the cart follows an edit to this request. */}
      {r.status === "approved" && user.isMentor && (
        <VendorCart key={r.updatedAt} vendor={r.vendor} onChanged={reload} />
      )}

      {/* Lists are of requests: a wishlist item joins one once it's promoted. */}
      {!wished && <RequestLists requestId={r.id} />}

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
              <div className="min-w-0">
                <p className="text-secondary-900">
                  <span className="font-semibold">
                    {EVENT_LABELS[e.action] ?? STATUS[e.action as RequestStatus]?.label ?? e.action}
                  </span>{" "}
                  by {e.userName}
                </p>
                {e.note && (
                  <p className="text-secondary-600 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    “{e.note}”
                  </p>
                )}
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
      <dd className="min-w-0 text-secondary-900 [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

const isLink = (text: string) => /^https?:\/\/\S+$/.test(text);

function EditForm({ request, onDone }: { request: RequestDetail; onDone: () => void }) {
  const categories = useLoad(async () => {
    const res = await api.categories.$get({ query: {} });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).filter((c) => !c.isArchived || c.id === request.categoryId);
  }, []);
  const catalogCategories = useLoad(async () => {
    const res = await api.catalog.categories.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [quantity, setQuantity] = useState(String(request.quantity));
  const [packQuantity, setPackQuantity] = useState(String(request.packQuantity));
  const [packUnit, setPackUnit] = useState(request.packUnit);
  const currentPrice =
    request.unitPriceCents === null ? "" : (request.unitPriceCents / 100).toFixed(2);
  const [price, setPrice] = useState(currentPrice);
  const [link, setLink] = useState(request.url);
  // A new link is looked up like New Request's: what it found, for the link it was found for.
  const [found, setFound] = useState<(Partial<Draft> & { for: string }) | null>(null);
  const [lookingFor, setLookingFor] = useState<string | null>(null);
  // The link as it is now, so a lookup that comes back after it changed again is dropped.
  const latest = useRef(link.trim());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Take the new link's name and price, or keep the request's.
  const [useFound, setUseFound] = useState(true);
  const [catalogCategory, setCatalogCategory] = useState("");
  const [categoryId, setCategoryId] = useState(String(request.categoryId));
  const [reason, setReason] = useState(request.reason);
  const [priority, setPriority] = useState<Priority>(request.priority);
  const [needBy, setNeedBy] = useState(msToDateInput(request.needBy));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const quantitiesBad = parseQuantity(quantity) === null || parseQuantity(packQuantity) === null;
  const newLink = link.trim();
  const linkChanged = newLink !== request.url;
  const linkOk = isLink(newLink);
  const lookedUp = found !== null && found.for === newLink;
  const looking = lookingFor === newLink;
  const foundName = lookedUp && !found.lookupError ? found.name || null : null;
  // A link new to the catalog needs a catalog category, like a new part on New Request.
  const needsCatalogCategory = linkChanged && lookedUp && !found.catalogKnown;
  const linkBlocked =
    linkChanged && (!linkOk || !lookedUp || (needsCatalogCategory && !catalogCategory));

  async function lookUp(url: string) {
    if (url === request.url || !isLink(url) || found?.for === url || lookingFor === url) return;
    setLookingFor(url);
    const result = await lookUpDraft(url);
    setLookingFor((current) => (current === url ? null : current));
    if (latest.current !== url) return;
    setFound({ ...result, for: url });
    setCatalogCategory(result.catalogCategory ?? "");
    const name = result.lookupError ? null : result.name;
    setUseFound(!!name);
    if (name && result.price) setPrice(result.price);
  }

  /** A pasted or typed link is looked up once it stops changing. */
  function changeLink(text: string) {
    setLink(text);
    latest.current = text.trim();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void lookUp(text.trim()), 800);
  }

  function choose(useNew: boolean) {
    setUseFound(useNew);
    setPrice(useNew && found?.price ? found.price : currentPrice);
  }

  /** What the request's item becomes with the new link: its details, from the lookup. */
  function linkFields() {
    if (!linkChanged || !found) return {};
    return {
      url: newLink,
      ...(found.vendor ? { vendor: found.vendor } : {}),
      sku: found.sku || null,
      variant: found.variant || null,
      image: found.image || null,
      storePlatform: found.storePlatform ?? null,
      storeVariantId: found.storeVariantId ?? null,
      ...(found.catalogKnown ? {} : { catalogCategory }),
      ...(found.sourceTitle
        ? {
            catalogName: found.variant
              ? `${found.sourceTitle} (${found.variant})`
              : found.sourceTitle,
          }
        : {}),
      ...(useFound && foundName
        ? { title: foundName, ...(found.currency ? { currency: found.currency } : {}) }
        : {}),
    };
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (quantitiesBad || linkBlocked) return;
    const unitPriceCents = parseDollars(price);
    if (Number.isNaN(unitPriceCents)) return setError("Price must be a dollar amount like 12.50.");
    setBusy(true);
    const res = await api.requests[":id"].$patch({
      param: { id: String(request.id) },
      json: {
        quantity: parseQuantity(quantity) as number,
        packQuantity: parseQuantity(packQuantity) as number,
        packUnit: packUnit.trim(),
        unitPriceCents,
        categoryId: Number(categoryId),
        reason,
        priority,
        needBy: dateInputToMs(needBy),
        ...linkFields(),
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
          <div className="sm:col-span-3 space-y-3">
            <Field
              label="Link"
              hint={
                !linkChanged
                  ? "The product's page"
                  : looking
                    ? "Looking up the new link…"
                    : !lookedUp
                      ? "Press Enter or click away to look up the new link"
                      : undefined
              }
              error={linkChanged && newLink && !linkOk ? "Paste a link starting with http" : null}
            >
              <TextField
                kind="url"
                type="url"
                value={link}
                onChange={(e) => changeLink(e.target.value)}
                onBlur={() => void lookUp(newLink)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void lookUp(newLink);
                  }
                }}
                required
              />
            </Field>
            {linkChanged && lookedUp && (
              <div className="space-y-2 rounded-lg border border-line bg-inset p-3 text-sm">
                {foundName ? (
                  <>
                    <p className="text-secondary-700 [overflow-wrap:anywhere]">
                      The new link is <span className="font-semibold">{foundName}</span>
                      {found.price &&
                        `, ${formatCents(parseDollars(found.price), found.currency)} each`}
                      .
                    </p>
                    <div className="flex flex-wrap gap-x-5 gap-y-1">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="link-details"
                          checked={useFound}
                          onChange={() => choose(true)}
                        />
                        Use its name and price
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="link-details"
                          checked={!useFound}
                          onChange={() => choose(false)}
                        />
                        Keep the current name and price
                      </label>
                    </div>
                  </>
                ) : (
                  <p className="text-secondary-700">
                    {found.lookupError
                      ? `Couldn't look up the new link: ${found.lookupError} `
                      : ""}
                    The name and price stay as they are. Change the price below if it's different.
                  </p>
                )}
                {needsCatalogCategory && (
                  <Field
                    label="Catalog category"
                    hint={
                      found.catalogCategoryGuessed && catalogCategory === found.catalogCategory
                        ? "Guessed from the name. Check it's right and change it if not."
                        : "This part is new to the catalog."
                    }
                    warn={found.catalogCategoryGuessed && catalogCategory === found.catalogCategory}
                  >
                    <select
                      className={inputClass}
                      value={catalogCategory}
                      onChange={(e) => setCatalogCategory(e.target.value)}
                      required
                    >
                      <option value="" disabled>
                        Pick one…
                      </option>
                      {(catalogCategories.data ?? []).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            )}
          </div>
          <Field label="Quantity" error={quantityError(quantity)}>
            <QuantityInput value={quantity} onChange={setQuantity} required />
          </Field>
          <Field
            label="Pack of"
            hint={
              packHint(parseQuantity(quantity), parseQuantity(packQuantity), packUnit.trim()) ??
              "Parts in one of these, or an amount: 100 ft"
            }
            error={quantityError(packQuantity)}
          >
            <PackInput
              quantity={packQuantity}
              unit={packUnit}
              onQuantity={setPackQuantity}
              onUnit={setPackUnit}
              required
            />
          </Field>
          <Field label="Price each">
            <TextField
              typeable
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
            <Field label="Why do we need it?" hint="Optional">
              <TextField
                multiline
                kind="reason"
                className="min-h-20"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
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
          <Button type="submit" disabled={busy || quantitiesBad || linkBlocked || looking}>
            {busy ? "Saving…" : request.status === "approved" ? "Save and re-approve" : "Save"}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </Card>
    </form>
  );
}
