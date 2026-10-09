import { amazonAsin, isAmazonShortLink } from "@g3/worker-orders/product-key";
import { chargesByCategory } from "@g3/worker-orders/split";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { cartLinks } from "../../shared/cart";
import { Deadline, isLate } from "../../shared/deadline";
import { ExportCsvButton } from "../../shared/export-csv";
import { formatCents, formatDay, parseDollars, startOfToday } from "../../shared/format";
import { PRIORITY_ORDER, PriorityBadge } from "../../shared/priority";
import type { OrderRequest, Vendor } from "../../shared/types";
import { Button, ErrorBanner, Loading, Page, SuccessBanner, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { useVendors } from "../../shared/vendors";

type Group = {
  vendor: string;
  profile: Vendor | undefined;
  /** Has a Blocking item or one past its place-by date. */
  placeToday: boolean;
  items: OrderRequest[];
};
type LineEdit = { quantity: string; price: string };

const vendorKey = (vendor: string) => vendor.trim().toLowerCase();
const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

/** The team's sales tax rate, charged by every vendor that doesn't have our exemption on file. */
const TAX_RATE = 0.089;

/** Whether the vendor has an unexpired tax-exempt certificate on file. */
const isTaxExempt = (vendor: Vendor | undefined) =>
  !!vendor &&
  "taxExempt" in vendor &&
  vendor.taxExempt &&
  (vendor.taxExemptExpires === null || vendor.taxExemptExpires >= startOfToday());

const priorityRank = (r: OrderRequest) => PRIORITY_ORDER.indexOf(r.priority);

/** One vendor's approved requests as its cart, most urgent lines first. */
function cartFor(items: OrderRequest[], vendorFor: (name: string) => Vendor | undefined): Group {
  const vendor = vendorFor(items[0].vendor);
  return {
    vendor: items[0].vendor,
    profile: vendor,
    placeToday: items.some((r) => r.priority === "blocking" || isLate(r, vendor)),
    items: [...items].sort(
      (a, b) =>
        priorityRank(a) - priorityRank(b) ||
        (a.needBy ?? Number.MAX_SAFE_INTEGER) - (b.needBy ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title),
    ),
  };
}

/**
 * One vendor's cart, as on the Carts page (a request's page shows its vendor's): everything
 * approved from that vendor, ready to place as one order. Nothing when nothing is approved there.
 */
export function VendorCart({
  vendor,
  onChanged,
}: {
  vendor: string;
  /** After the order is placed or a line removed (the request may have changed). */
  onChanged: () => void;
}) {
  const sac = useLoad(async () => {
    const res = await api["share-a-cart"].status.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const { data, error, reload } = useLoad(async () => {
    const res = await api.requests.$get({ query: { status: "approved" } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [done, setDone] = useState<string | null>(null);
  const { vendorFor } = useVendors();
  const key = vendorKey(vendor);
  const items = (data ?? []).filter((r) => vendorKey(r.vendor) === key);

  if (error) return <ErrorBanner message={error} />;
  if (!data) return <Loading />;
  const changed = (message: string) => {
    setDone(message);
    reload();
    onChanged();
  };
  return (
    <>
      {done && <SuccessBanner message={done} />}
      {items.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-400 font-sans">
            Everything approved to order from {items[0].vendor}
          </h2>
          <VendorOrder
            group={cartFor(items, vendorFor)}
            shareACart={sac.data?.vendors.includes(key) ? { connected: sac.data.connected } : null}
            onPlaced={changed}
            onRemoved={changed}
          />
        </section>
      )}
    </>
  );
}

/**
 * Approved requests grouped by vendor, for placing orders (mentors). Quantities and prices can be
 * corrected to what the vendor actually charges; with shipping and tax, those are the only numbers
 * that count against budgets.
 */
export function OrderingPage() {
  const sac = useLoad(async () => {
    const res = await api["share-a-cart"].status.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const { data, error, reload } = useLoad(async () => {
    const res = await api.requests.$get({ query: { status: "approved" } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [done, setDone] = useState<string | null>(null);

  const { vendorFor } = useVendors();

  // Most urgent carts first: anything Blocking or past its place-by date, then by the highest
  // priority inside, then the biggest.
  const groups = useMemo<Group[]>(() => {
    const byVendor = new Map<string, OrderRequest[]>();
    for (const r of data ?? []) {
      const key = vendorKey(r.vendor);
      byVendor.set(key, [...(byVendor.get(key) ?? []), r]);
    }
    return [...byVendor.values()]
      .map((items) => cartFor(items, vendorFor))
      .sort(
        (a, b) =>
          Number(b.placeToday) - Number(a.placeToday) ||
          Math.min(...a.items.map(priorityRank)) - Math.min(...b.items.map(priorityRank)) ||
          b.items.length - a.items.length ||
          a.vendor.localeCompare(b.vendor),
      );
  }, [data, vendorFor]);

  const lines = groups.reduce((n, g) => n + g.items.length, 0);
  const estimate = (data ?? []).reduce((n, r) => n + (r.unitPriceCents ?? 0) * r.quantity, 0);

  return (
    <Page title="Carts" actions={<ExportCsvButton />}>
      {error && <ErrorBanner message={error} />}
      {done && <SuccessBanner message={done} />}
      {!data ? (
        <Loading />
      ) : groups.length === 0 ? (
        <p className="text-sm text-secondary-500">Nothing approved is waiting to be ordered.</p>
      ) : (
        <>
          <p className="text-sm text-secondary-600 tabular-nums">
            {lines} {lines === 1 ? "item" : "items"} from {groups.length}{" "}
            {groups.length === 1 ? "vendor" : "vendors"} · estimated{" "}
            <span className="font-semibold text-secondary-900">{formatCents(estimate)}</span> before
            shipping and tax
          </p>
          {groups.map((g) => (
            <VendorOrder
              key={vendorKey(g.vendor)}
              group={g}
              shareACart={
                sac.data?.vendors.includes(vendorKey(g.vendor))
                  ? { connected: sac.data.connected }
                  : null
              }
              onPlaced={(message) => {
                setDone(message);
                reload();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onRemoved={(message) => {
                setDone(message);
                reload();
              }}
            />
          ))}
        </>
      )}
    </Page>
  );
}

function VendorOrder({
  group,
  shareACart,
  onPlaced,
  onRemoved,
}: {
  group: Group;
  /** Set when Share-A-Cart supports this vendor. */
  shareACart: { connected: boolean } | null;
  onPlaced: (message: string) => void;
  /** A line was canceled (trashed) instead of ordered. */
  onRemoved: (message: string) => void;
}) {
  const [sacBusy, setSacBusy] = useState(false);
  const [sacLink, setSacLink] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, LineEdit>>(() =>
    Object.fromEntries(
      group.items.map((r) => [
        r.id,
        { quantity: String(r.quantity), price: dollars(r.unitPriceCents) },
      ]),
    ),
  );
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [shipping, setShipping] = useState("");
  // null until someone types in the Tax box; until then it shows (and uses) the default.
  const [tax, setTax] = useState<string | null>(null);
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Lines in this order: the checked ones, or all of them when nothing is checked.
  const inOrder = selected.size > 0 ? group.items.filter((r) => selected.has(r.id)) : group.items;
  const parsed = inOrder.map((r) => {
    const e = edits[r.id] ?? { quantity: String(r.quantity), price: dollars(r.unitPriceCents) };
    const quantity = Number(e.quantity);
    const price = parseDollars(e.price);
    return {
      r,
      quantity,
      price,
      ok: Number.isInteger(quantity) && quantity >= 1 && price !== null && !Number.isNaN(price),
    };
  });
  // One-click cart for the lines in this order, at the quantities entered here.
  const cart = cartLinks(
    parsed.map((l) => ({
      url: l.r.url,
      sku: l.r.sku,
      storePlatform: l.r.storePlatform,
      storeVariantId: l.r.storeVariantId,
      quantity: Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : l.r.quantity,
    })),
  );
  const shippingCents = parseDollars(shipping) ?? 0;
  const itemsTotal = parsed.reduce((n, l) => n + (l.ok ? l.quantity * (l.price as number) : 0), 0);
  // Tax starts at 8.9% of the items (nothing at tax-exempt vendors) and follows the items total
  // until someone types their own amount.
  const defaultTaxCents = isTaxExempt(group.profile) ? 0 : Math.round(itemsTotal * TAX_RATE);
  const taxText = tax ?? dollars(defaultTaxCents);
  const taxCents = parseDollars(taxText) ?? 0;
  const feesOk = !Number.isNaN(shippingCents) && !Number.isNaN(taxCents);
  const valid = parsed.every((l) => l.ok) && feesOk;
  const charges = valid
    ? chargesByCategory(
        parsed.map((l) => ({
          categoryId: l.r.categoryId,
          quantity: l.quantity,
          unitPriceCents: l.price,
        })),
        shippingCents,
        taxCents,
      )
    : null;
  const categoryName = new Map(group.items.map((r) => [r.categoryId, r.categoryName]));

  const setEdit = (id: number, patch: Partial<LineEdit>) =>
    setEdits((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = selected.size === group.items.length;

  /** Takes a line off the order list by canceling the request (the requester sees why). */
  async function trash(r: OrderRequest) {
    const reason = window.prompt(
      `Remove “${r.title}” and cancel ${r.requesterName}'s request? Say why (shown to them):`,
    );
    if (reason === null) return;
    setError(null);
    const res = await api.requests[":id"][":action"].$post({
      param: { id: String(r.id), action: "cancel" },
      json: { note: reason.trim() || null },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    setSelected((s) => {
      const next = new Set(s);
      next.delete(r.id);
      return next;
    });
    onRemoved(`Removed “${r.title}” (request canceled).`);
  }

  async function place() {
    if (!valid) {
      return setError(
        "Every line needs a quantity and a price; shipping and tax must be dollar amounts.",
      );
    }
    const what =
      inOrder.length === group.items.length
        ? "this order"
        : `an order of ${inOrder.length} item(s)`;
    if (
      !window.confirm(
        `Place ${what} with ${group.vendor} for ${formatCents(itemsTotal + shippingCents + taxCents)}?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    const res = await api.orders.$post({
      json: {
        vendor: group.vendor,
        lines: parsed.map((l) => ({
          requestId: l.r.id,
          quantity: l.quantity,
          unitPriceCents: l.price as number,
        })),
        shippingCents,
        taxCents,
        tracking: tracking.trim() || null,
      },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    const { ordered, skipped } = await res.json();
    onPlaced(
      `Placed ${group.vendor} order: ${ordered.length} item${ordered.length === 1 ? "" : "s"}, ${formatCents(itemsTotal + shippingCents + taxCents)}.${
        skipped.length ? ` ${skipped.length} skipped (no longer approved).` : ""
      }`,
    );
  }

  /** Builds the cart at Share-A-Cart (lines and quantities as on screen) and opens it. */
  async function openShareACart() {
    // Open the tab now, while this still counts as the click; browsers block it after the await.
    const tab = window.open("", "_blank");
    setSacBusy(true);
    setError(null);
    const res = await api["share-a-cart"].carts.$post({
      json: {
        vendor: group.vendor,
        lines: parsed.map((l) => ({
          requestId: l.r.id,
          quantity: Number.isInteger(l.quantity) && l.quantity > 0 ? l.quantity : l.r.quantity,
        })),
      },
    });
    setSacBusy(false);
    if (!res.ok) {
      tab?.close();
      return setError(await getErrorMessage(res));
    }
    const body = await res.json();
    setSacLink(body.url);
    if (tab) tab.location.href = body.url;
    else window.open(body.url, "_blank");
    if (body.skipped.length > 0) {
      setError(`Left out (no store item number): ${body.skipped.join(", ")}. Add those by hand.`);
    }
  }

  /** McMaster-Carr takes a pasted list of "part number,quantity" lines on its order page. */
  const isMcMaster = /mcmaster/i.test(group.vendor);

  async function copyList() {
    if (isMcMaster) {
      const missing = group.items.filter((r) => !r.sku);
      const text = group.items
        .filter((r) => r.sku)
        .map((r) => `${r.sku},${edits[r.id]?.quantity ?? r.quantity}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      if (missing.length > 0) {
        setError(
          `Left out (no McMaster part number): ${missing.map((r) => r.title).join(", ")}. Add those by hand.`,
        );
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      return;
    }
    const text = group.items
      .map((r) => {
        const e = edits[r.id];
        const price = parseDollars(e?.price ?? "");
        return [
          `${e?.quantity ?? r.quantity} × ${r.title}`,
          r.variant,
          r.sku,
          price !== null && !Number.isNaN(price) ? `${formatCents(price, r.currency)} ea` : null,
          r.url,
        ]
          .filter(Boolean)
          .join(" — ");
      })
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const small = `${inputClass} !py-1 !px-2`;

  return (
    <section className="bg-surface border border-secondary-200 rounded-xl overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 bg-secondary-50 border-b border-secondary-200">
        <h2
          className="min-w-0 max-w-full truncate font-semibold text-secondary-900"
          title={group.vendor}
        >
          {group.vendor}
        </h2>
        {group.placeToday && (
          <span className="rounded-full border border-primary-300 bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-700">
            ⛔ Place today
          </span>
        )}
        <p className="text-sm text-secondary-600 whitespace-nowrap">
          {group.items.length} {group.items.length === 1 ? "item" : "items"}
          {selected.size > 0 && ` · ${selected.size} selected`}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {cart.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              title={
                cart.manual > 0
                  ? `${cart.manual} item(s) can't be added automatically; add those by hand.`
                  : "Opens the store with these items and quantities in the cart"
              }
              className="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-600"
            >
              🛒 Add {link.count} to {link.label} ↗
            </a>
          ))}
          {shareACart &&
            (shareACart.connected ? (
              <Button className="!py-1.5" disabled={sacBusy} onClick={openShareACart}>
                {sacBusy ? "Building cart…" : "🛒 Share-A-Cart ↗"}
              </Button>
            ) : (
              <Link to="/settings" className="text-xs underline text-secondary-500">
                Connect Share-A-Cart for one-click carts
              </Link>
            ))}
          {sacLink && (
            <a
              href={sacLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline text-primary-600"
            >
              Open cart again
            </a>
          )}
          {!shareACart && cart.links.length > 0 && cart.manual > 0 && (
            <span className="text-xs text-secondary-500">+{cart.manual} by hand</span>
          )}
          <Button
            variant="secondary"
            onClick={copyList}
            className="!py-1.5"
            title={
              isMcMaster
                ? 'Copies "part number,quantity" lines to paste into McMaster\'s order page'
                : undefined
            }
          >
            {copied ? "Copied ✓" : "Copy list"}
          </Button>
        </div>
      </header>
      <Nudges vendor={group.profile} itemsTotal={itemsTotal} />
      {/* relative: the cells' screen-reader-only labels are positioned, and without it they'd
          sit outside this scroll box and widen the whole page on a phone. */}
      <div className="relative overflow-x-auto">
        {/* Fixed column widths: long names wrap inside their column instead of squeezing the
            others; on narrow screens the table scrolls sideways. */}
        <table className="w-full min-w-[55rem] table-fixed text-sm">
          <colgroup>
            <col className="w-10" />
            <col className="w-20" />
            <col />
            <col className="w-32" />
            <col className="w-28" />
            <col className="w-24" />
            <col className="w-40" />
            <col className="w-28" />
            <col className="w-10" />
          </colgroup>
          <thead>
            <tr className="text-xs text-secondary-500 border-b border-secondary-100">
              <th className="py-2 pl-4 pr-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(group.items.map((r) => r.id)))
                  }
                  aria-label="Select all"
                />
              </th>
              <th className="py-2 pr-3 font-semibold text-left">Qty</th>
              <th className="py-2 pr-3 font-semibold text-left">Item</th>
              <th className="py-2 pr-3 font-semibold text-left">SKU</th>
              <th className="py-2 pr-3 font-semibold text-left">Each $</th>
              <th className="py-2 pr-3 font-semibold text-right">Total</th>
              <th className="py-2 pr-3 font-semibold text-left">Budget</th>
              <th className="py-2 pr-4 font-semibold text-left">For</th>
              <th className="py-2 pr-3">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((r) => {
              const e = edits[r.id];
              const q = Number(e?.quantity);
              const p = parseDollars(e?.price ?? "");
              const line =
                Number.isInteger(q) && q > 0 && p !== null && !Number.isNaN(p) ? q * p : null;
              const dimmed = selected.size > 0 && !selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  className={`border-b border-secondary-100 last:border-0 ${selected.has(r.id) ? "bg-primary-50" : ""} ${dimmed ? "opacity-50" : ""}`}
                >
                  <td className="py-1.5 pl-4 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.title}`}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="number"
                      min={1}
                      className={small}
                      value={e?.quantity ?? ""}
                      onChange={(ev) => setEdit(r.id, { quantity: ev.target.value })}
                      aria-label={`${r.title} quantity`}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        title={r.title}
                        className="line-clamp-2 break-words text-secondary-900 hover:text-primary-500 font-medium"
                      >
                        {r.title} ↗
                      </a>
                    ) : (
                      <span
                        title={r.title}
                        className="line-clamp-2 break-words text-secondary-900 font-medium"
                      >
                        {r.title}
                      </span>
                    )}
                    {r.variant && (
                      <span className="block truncate text-xs text-secondary-500" title={r.variant}>
                        {r.variant}
                      </span>
                    )}
                    {(r.priority !== "normal" || r.needBy !== null) && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-secondary-500">
                        <PriorityBadge priority={r.priority} />
                        <Deadline request={r} vendor={group.profile} />
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {shareACart && !amazonAsin(r) && !isAmazonShortLink(r.url) && (
                      <span
                        className="mb-0.5 block text-xs font-semibold text-amber-700"
                        title="Share-A-Cart leaves this out. Edit the request's link to the product's Amazon page."
                      >
                        No Amazon ASIN
                      </span>
                    )}
                    {r.sku ? (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(r.sku ?? "")}
                        className="block max-w-full truncate font-mono text-xs text-secondary-700 hover:text-primary-500"
                        title={`Copy ${r.sku}`}
                      >
                        {r.sku}
                      </button>
                    ) : (
                      <span className="text-secondary-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      className={small}
                      inputMode="decimal"
                      value={e?.price ?? ""}
                      onChange={(ev) => setEdit(r.id, { price: ev.target.value })}
                      placeholder="0.00"
                      aria-label={`${r.title} price each`}
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {formatCents(line, r.currency)}
                  </td>
                  <td className="py-1.5 pr-3 text-secondary-600">
                    <span className="block truncate" title={r.categoryName}>
                      {r.categoryName}
                    </span>
                  </td>
                  <td className="py-1.5 pr-4 text-secondary-600">
                    <Link
                      to={`/requests/${r.id}`}
                      title={r.requesterName}
                      className="block truncate hover:text-primary-500"
                    >
                      {r.requesterName}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-right">
                    <button
                      type="button"
                      onClick={() => trash(r)}
                      className="rounded px-1.5 py-1 text-secondary-400 hover:bg-primary-50 hover:text-primary-600"
                      title="Remove from the order (cancels the request)"
                      aria-label={`Remove ${r.title}`}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className="px-4 py-3 border-t border-secondary-200 bg-secondary-50 space-y-3">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1">
            <span className="block text-xs text-secondary-500">Shipping $</span>
            <input
              className={`${small} !w-24`}
              inputMode="decimal"
              value={shipping}
              onChange={(e) => setShipping(e.target.value)}
              placeholder={
                group.profile &&
                "typicalShippingCents" in group.profile &&
                group.profile.typicalShippingCents !== null
                  ? `~${(group.profile.typicalShippingCents / 100).toFixed(2)}`
                  : "0.00"
              }
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-secondary-500">Tax $</span>
            <input
              className={`${small} !w-24`}
              inputMode="decimal"
              value={taxText}
              onChange={(e) => setTax(e.target.value)}
              placeholder="0.00"
              title={
                isTaxExempt(group.profile)
                  ? "Tax exempt: starts at $0"
                  : "Starts at 8.9% of the items; type to change it"
              }
            />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-secondary-500">Tracking # (optional)</span>
            <input
              className={`${small} !w-44`}
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
          </label>
          <div className="ml-auto text-right tabular-nums">
            <p className="text-xs text-secondary-500">
              Items {formatCents(itemsTotal)} + shipping{" "}
              {formatCents(Number.isNaN(shippingCents) ? 0 : shippingCents)} + tax{" "}
              {formatCents(Number.isNaN(taxCents) ? 0 : taxCents)}
            </p>
            <p className="text-lg font-semibold text-secondary-900">
              {formatCents(
                itemsTotal +
                  (Number.isNaN(shippingCents) ? 0 : shippingCents) +
                  (Number.isNaN(taxCents) ? 0 : taxCents),
              )}
            </p>
          </div>
          <Button disabled={busy || !valid} onClick={place}>
            {busy
              ? "Placing…"
              : selected.size > 0
                ? `Place order (${selected.size})`
                : "Place order"}
          </Button>
        </div>
        {charges && charges.size > 0 && (
          <p className="text-xs text-secondary-600 tabular-nums">
            Charged to budgets:{" "}
            {[...charges]
              .map(([id, c]) => {
                const extra = c.shipping + c.tax;
                return `${categoryName.get(id) ?? "?"} ${formatCents(c.items + extra)}${extra ? ` (incl. ${formatCents(extra)} shipping/tax)` : ""}`;
              })
              .join(" · ")}
          </p>
        )}
        {error && <ErrorBanner message={error} />}
      </footer>
    </section>
  );
}

/**
 * Reminders from the vendor's profile for the person placing the order: free-shipping gap,
 * minimum order, tax exemption and team sign-in, timing, payment, and credits to use.
 */
function Nudges({ vendor, itemsTotal }: { vendor: Vendor | undefined; itemsTotal: number }) {
  if (!vendor || !("credits" in vendor)) return null;
  const today = startOfToday();
  const notes: { text: string; tone: "good" | "warn" | "info" }[] = [];
  if (vendor.freeShippingCents !== null) {
    const gap = vendor.freeShippingCents - itemsTotal;
    notes.push(
      gap > 0
        ? { text: `🚚 ${formatCents(gap)} more for free shipping`, tone: "info" }
        : { text: "🚚 Qualifies for free shipping", tone: "good" },
    );
  }
  if (vendor.minimumOrderCents !== null && itemsTotal < vendor.minimumOrderCents) {
    notes.push({
      text: `⚠ Below the ${formatCents(vendor.minimumOrderCents)} minimum order`,
      tone: "warn",
    });
  }
  if (vendor.taxExempt) {
    const expired = vendor.taxExemptExpires !== null && vendor.taxExemptExpires < today;
    notes.push(
      expired
        ? {
            text: `⚠ Tax-exempt certificate expired ${formatDay(vendor.taxExemptExpires as number)}`,
            tone: "warn",
          }
        : {
            text: vendor.teamAccountLogin
              ? "🧾 Tax exempt: sign in to the team account before checkout"
              : "🧾 Tax exempt: certificate on file",
            tone: "good",
          },
    );
  } else if (vendor.teamAccountLogin) {
    notes.push({ text: "🔑 Sign in to the team account before checkout", tone: "info" });
  }
  const timing = [
    vendor.leadTimeDays !== null && `lead time ${vendor.leadTimeDays}d`,
    vendor.shippingDays !== null && `ships in ${vendor.shippingDays}d`,
    vendor.orderCutoff && `order by ${vendor.orderCutoff}`,
  ].filter(Boolean);
  if (timing.length) notes.push({ text: `⏱ ${timing.join(", ")}`, tone: "info" });
  const pay = [
    vendor.paymentMethod && `pay with ${vendor.paymentMethod}`,
    vendor.accountOwner && `account: ${vendor.accountOwner}`,
  ].filter(Boolean);
  if (pay.length) notes.push({ text: `💳 ${pay.join(" · ")}`, tone: "info" });
  for (const cr of vendor.credits) {
    if (cr.expiresAt !== null && cr.expiresAt < today) continue;
    if (cr.balanceCents === 0) continue;
    notes.push({
      text: `🎟 ${cr.label}${cr.code ? ` (code ${cr.code})` : ""}${cr.balanceCents !== null ? ` · ${formatCents(cr.balanceCents)} left` : ""}${cr.expiresAt !== null ? ` · expires ${formatDay(cr.expiresAt)}` : ""}`,
      tone: "good",
    });
  }
  if (vendor.notes) notes.push({ text: `📝 ${vendor.notes}`, tone: "info" });
  if (notes.length === 0) return null;
  const tones = {
    good: "text-emerald-800",
    warn: "text-primary-700 font-semibold",
    info: "text-secondary-700",
  };
  return (
    <ul className="px-4 py-2 border-b border-secondary-100 flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {notes.map((n) => (
        <li key={n.text} className={tones[n.tone]}>
          {n.text}
        </li>
      ))}
    </ul>
  );
}
