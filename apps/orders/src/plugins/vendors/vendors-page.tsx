import { type FormEvent, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import {
  dateInputToMs,
  formatCents,
  formatDate,
  msToDateInput,
  parseDollars,
} from "../../shared/format";
import type { VendorProfile } from "../../shared/types";
import { Button, Card, ErrorBanner, Field, Loading, Page, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { useVendors } from "../../shared/vendors";

const CREDIT_KINDS = {
  voucher: "Voucher",
  credit: "Store credit",
  discount: "Discount code",
} as const;
type CreditKind = keyof typeof CREDIT_KINDS;

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

/** Vendor profiles (mentors): shipping, tax exemption, lead times, payment, and credits. */
export function VendorsPage() {
  const { vendors, error, reload } = useVendors();
  const categories = useLoad(async () => {
    const res = await api.categories.$get({ query: {} });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).filter((c) => !c.isArchived);
  }, []);
  const [filter, setFilter] = useState("");
  const list = (vendors ?? []).filter(
    (v): v is VendorProfile =>
      "credits" in v && v.name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Page title="Vendors">
      <input
        className={inputClass}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter vendors…"
      />
      {error && <ErrorBanner message={error} />}
      {!vendors ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="text-sm text-secondary-500">
          No vendors yet. They appear once someone requests a part.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((v) => (
            <VendorCard
              key={v.key}
              vendor={v}
              categories={categories.data ?? []}
              onChanged={reload}
            />
          ))}
        </div>
      )}
    </Page>
  );
}

function VendorCard({
  vendor: v,
  categories,
  onChanged,
}: {
  vendor: VendorProfile;
  categories: { id: number; name: string }[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const facts = [
    v.taxExempt &&
      `Tax exempt${v.taxExemptExpires ? ` (certificate until ${formatDate(v.taxExemptExpires)})` : ""}`,
    v.teamAccountLogin && "Sign in to the team account",
    v.freeShippingCents !== null && `Free shipping over ${formatCents(v.freeShippingCents)}`,
    v.typicalShippingCents !== null && `Shipping usually ${formatCents(v.typicalShippingCents)}`,
    v.minimumOrderCents !== null && `Minimum order ${formatCents(v.minimumOrderCents)}`,
    v.leadTimeDays !== null && `Lead time ${v.leadTimeDays} day${v.leadTimeDays === 1 ? "" : "s"}`,
    v.shippingDays !== null && `Ships in ${v.shippingDays} day${v.shippingDays === 1 ? "" : "s"}`,
    v.orderCutoff && `Order by ${v.orderCutoff}`,
    v.paymentMethod && `Pay with ${v.paymentMethod}`,
    v.accountOwner && `Account: ${v.accountOwner}`,
  ].filter(Boolean) as string[];

  return (
    <Card className="!p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-secondary-900">{v.name}</h2>
        <p className="text-xs text-secondary-500">
          {v.openItems} waiting to order · {v.ordersThisYear} order
          {v.ordersThisYear === 1 ? "" : "s"} this year
        </p>
      </div>
      {facts.length > 0 ? (
        <p className="mt-1 text-sm text-secondary-600">{facts.join(" · ")}</p>
      ) : (
        !editing && <p className="mt-1 text-sm text-secondary-400">No profile yet.</p>
      )}
      {v.notes && <p className="mt-1 text-sm text-secondary-500 whitespace-pre-wrap">{v.notes}</p>}
      {v.credits.length > 0 && !editing && (
        <ul className="mt-2 space-y-0.5 text-sm">
          {v.credits.map((cr) => (
            <li key={cr.id} className="text-emerald-800">
              🎟 {cr.label}
              {cr.balanceCents !== null && ` · ${formatCents(cr.balanceCents)} left`}
              {cr.code && <span className="ml-1 font-mono text-xs">{cr.code}</span>}
              {cr.expiresAt !== null && ` · expires ${formatDate(cr.expiresAt)}`}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <div className="mt-3 space-y-4">
          <ProfileForm
            vendor={v}
            categories={categories}
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
          />
          <Credits vendor={v} onChanged={onChanged} />
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 text-xs text-secondary-500 hover:text-secondary-900 underline"
          onClick={() => setEditing(true)}
        >
          {v.hasProfile ? "Edit profile & credits" : "Add profile"}
        </button>
      )}
    </Card>
  );
}

function ProfileForm({
  vendor: v,
  categories,
  onDone,
}: {
  vendor: VendorProfile;
  categories: { id: number; name: string }[];
  onDone: () => void;
}) {
  const [f, setF] = useState({
    taxExempt: v.taxExempt,
    taxExemptExpires: msToDateInput(v.taxExemptExpires),
    teamAccountLogin: v.teamAccountLogin,
    freeShipping: dollars(v.freeShippingCents),
    typicalShipping: dollars(v.typicalShippingCents),
    minimumOrder: dollars(v.minimumOrderCents),
    leadTimeDays: v.leadTimeDays === null ? "" : String(v.leadTimeDays),
    shippingDays: v.shippingDays === null ? "" : String(v.shippingDays),
    orderCutoff: v.orderCutoff ?? "",
    paymentMethod: v.paymentMethod ?? "",
    accountOwner: v.accountOwner ?? "",
    notes: v.notes ?? "",
    defaultCategoryId: v.defaultCategoryId === null ? "" : String(v.defaultCategoryId),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const money = [
      parseDollars(f.freeShipping),
      parseDollars(f.typicalShipping),
      parseDollars(f.minimumOrder),
    ];
    if (money.some((m) => Number.isNaN(m)))
      return setError("Amounts must be dollar amounts like 50.");
    const days = (s: string) => (s.trim() === "" ? null : Number(s));
    const [lead, ship] = [days(f.leadTimeDays), days(f.shippingDays)];
    if ([lead, ship].some((d) => d !== null && (!Number.isInteger(d) || d < 0))) {
      return setError("Days must be whole numbers.");
    }
    setBusy(true);
    setError(null);
    const res = await api.vendors[":key"].$put({
      param: { key: encodeURIComponent(v.key) },
      json: {
        name: v.name,
        taxExempt: f.taxExempt,
        taxExemptExpires: dateInputToMs(f.taxExemptExpires),
        teamAccountLogin: f.teamAccountLogin,
        freeShippingCents: money[0],
        typicalShippingCents: money[1],
        minimumOrderCents: money[2],
        leadTimeDays: lead,
        shippingDays: ship,
        orderCutoff: f.orderCutoff || null,
        paymentMethod: f.paymentMethod || null,
        accountOwner: f.accountOwner || null,
        notes: f.notes || null,
        defaultCategoryId: f.defaultCategoryId ? Number(f.defaultCategoryId) : null,
      },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Free shipping over $">
          <input
            className={inputClass}
            inputMode="decimal"
            value={f.freeShipping}
            onChange={(e) => set({ freeShipping: e.target.value })}
          />
        </Field>
        <Field label="Typical shipping $">
          <input
            className={inputClass}
            inputMode="decimal"
            value={f.typicalShipping}
            onChange={(e) => set({ typicalShipping: e.target.value })}
          />
        </Field>
        <Field label="Minimum order $">
          <input
            className={inputClass}
            inputMode="decimal"
            value={f.minimumOrder}
            onChange={(e) => set({ minimumOrder: e.target.value })}
          />
        </Field>
        <Field label="Lead time (days)" hint="Before it ships">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={f.leadTimeDays}
            onChange={(e) => set({ leadTimeDays: e.target.value })}
          />
        </Field>
        <Field label="Shipping (days)">
          <input
            type="number"
            min={0}
            className={inputClass}
            value={f.shippingDays}
            onChange={(e) => set({ shippingDays: e.target.value })}
          />
        </Field>
        <Field label="Order cutoff" hint='e.g. "2 PM ET for same-day shipping"'>
          <input
            className={inputClass}
            value={f.orderCutoff}
            onChange={(e) => set({ orderCutoff: e.target.value })}
          />
        </Field>
        <Field label="Payment method">
          <input
            className={inputClass}
            value={f.paymentMethod}
            onChange={(e) => set({ paymentMethod: e.target.value })}
            placeholder="e.g. Team credit card, PO"
          />
        </Field>
        <Field label="Account owner">
          <input
            className={inputClass}
            value={f.accountOwner}
            onChange={(e) => set({ accountOwner: e.target.value })}
          />
        </Field>
        <Field label="Default budget category">
          <select
            className={inputClass}
            value={f.defaultCategoryId}
            onChange={(e) => set({ defaultCategoryId: e.target.value })}
          >
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-secondary-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={f.taxExempt}
            onChange={(e) => set({ taxExempt: e.target.checked })}
          />
          Tax exempt (certificate on file)
        </label>
        {f.taxExempt && (
          <label className="flex items-center gap-2">
            Certificate expires
            <input
              type="date"
              className={`${inputClass} !w-auto !py-1`}
              value={f.taxExemptExpires}
              onChange={(e) => set({ taxExemptExpires: e.target.value })}
            />
          </label>
        )}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={f.teamAccountLogin}
            onChange={(e) => set({ teamAccountLogin: e.target.checked })}
          />
          Sign in to the team account before checkout
        </label>
      </div>
      <Field label="Notes">
        <textarea
          className={`${inputClass} min-h-16`}
          value={f.notes}
          onChange={(e) => set({ notes: e.target.value })}
          maxLength={500}
        />
      </Field>
      {error && <ErrorBanner message={error} />}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Close
        </Button>
      </div>
    </form>
  );
}

/** Vouchers, store credit and discount codes: add, update the balance, remove. */
function Credits({ vendor: v, onChanged }: { vendor: VendorProfile; onChanged: () => void }) {
  const [kind, setKind] = useState<CreditKind>("voucher");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [balance, setBalance] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const balanceCents = parseDollars(balance);
    if (Number.isNaN(balanceCents)) return setError("Balance must be a dollar amount.");
    const res = await api.vendors[":key"].credits.$post({
      param: { key: encodeURIComponent(v.key) },
      json: { kind, label, code: code || null, balanceCents, expiresAt: dateInputToMs(expires) },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    setLabel("");
    setCode("");
    setBalance("");
    setExpires("");
    setError(null);
    onChanged();
  }

  async function setCreditBalance(id: number, current: number | null) {
    const answer = window.prompt(
      "New balance ($):",
      current === null ? "" : (current / 100).toFixed(2),
    );
    if (answer === null) return;
    const balanceCents = parseDollars(answer);
    if (Number.isNaN(balanceCents)) return setError("Balance must be a dollar amount.");
    const res = await api.vendors.credits[":id"].$patch({
      param: { id: String(id) },
      json: { balanceCents },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    onChanged();
  }

  async function remove(id: number) {
    if (!window.confirm("Remove this credit?")) return;
    const res = await api.vendors.credits[":id"].$delete({ param: { id: String(id) } });
    if (!res.ok) return setError(await getErrorMessage(res));
    onChanged();
  }

  return (
    <div className="space-y-2 border-t border-secondary-100 pt-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-secondary-400">
        Vouchers, credits & codes
      </h3>
      {v.credits.length > 0 && (
        <ul className="space-y-1 text-sm">
          {v.credits.map((cr) => (
            <li key={cr.id} className="flex flex-wrap items-center gap-2">
              <span className="text-secondary-900">
                {CREDIT_KINDS[cr.kind]}: {cr.label}
                {cr.code && <span className="ml-1 font-mono text-xs">{cr.code}</span>}
                {cr.balanceCents !== null && ` · ${formatCents(cr.balanceCents)} left`}
                {cr.expiresAt !== null && ` · expires ${formatDate(cr.expiresAt)}`}
              </span>
              <button
                type="button"
                className="text-xs underline text-secondary-500"
                onClick={() => setCreditBalance(cr.id, cr.balanceCents)}
              >
                Update balance
              </button>
              <button
                type="button"
                className="text-xs underline text-secondary-500"
                onClick={() => remove(cr.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2 items-start">
        <select
          className={`${inputClass} !w-auto`}
          value={kind}
          onChange={(e) => setKind(e.target.value as CreditKind)}
        >
          {Object.entries(CREDIT_KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input
          className={`${inputClass} sm:!w-48`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Sponsor 15% off)"
          required
        />
        <input
          className={`${inputClass} sm:!w-32`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code"
        />
        <input
          className={`${inputClass} sm:!w-28`}
          inputMode="decimal"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          placeholder="Balance $"
        />
        <input
          type="date"
          className={`${inputClass} !w-auto`}
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          aria-label="Expires"
        />
        <Button type="submit">Add</Button>
      </form>
      {error && <ErrorBanner message={error} />}
    </div>
  );
}
