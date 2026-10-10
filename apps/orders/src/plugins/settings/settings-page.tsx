import { useAppOn, useTeamNames } from "@g3/ui";
import { DEFAULT_TEMPLATE, applyTemplate } from "@g3/worker-orders/naming";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { forgetIntake } from "../../shared/receive-dialog";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Loading,
  Page,
  SuccessBanner,
  inputClass,
} from "../../shared/ui";
import { useLoad } from "../../shared/use-load";

const EXAMPLE = {
  vendor: "West Coast Products",
  sku: "WCP-1018",
  title: "12t x 15mm Wide Aluminum Pulley (HTD 5mm, 8mm SplineXS Bore) | WCP",
  variant: "8mm SplineXS",
};

/** Mentors: the team's money and calendar, who edits the catalog, and how requests are named. */
export function SettingsPage() {
  // Receiving into Inventory is only a setting while the team has Inventory on.
  const inventoryOn = useAppOn("inventory");
  return (
    <Page title="Settings">
      <MoneyAndCalendar />
      <TrustedStudents />
      <ShareACart />
      {inventoryOn !== false && <InventoryOnReceive />}
      <NamingTemplate />
      <CategoryRules />
    </Page>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2026, i, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
);

/** The team's currency and fiscal calendar: what budgets, prices and fiscal years are in. */
function MoneyAndCalendar() {
  const settings = useLoad(async () => {
    const res = await api.settings.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [currency, setCurrency] = useState("");
  const [start, setStart] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!settings.data) return;
    setCurrency(settings.data.currency);
    setStart(settings.data.fiscalYearStart);
  }, [settings.data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api.settings.$put({
      json: { currency: currency.trim().toUpperCase(), fiscalYearStart: start },
    });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    // Every page reads these when it loads.
    window.location.reload();
  }

  return (
    <Card title="Money and calendar">
      {!settings.data ? (
        <Loading />
      ) : (
        <form onSubmit={save} className="space-y-3">
          <p className="text-sm text-secondary-600">
            Budgets and spending are counted by fiscal year, starting on the 1st of the month below.
            Changing it recounts every year.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Currency" hint="A 3-letter code: USD, CAD, EUR, ...">
              <input
                className={`${inputClass} uppercase`}
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value)}
              />
            </Field>
            <Field label="Fiscal year starts in">
              <select
                className={inputClass}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              >
                {MONTHS.map((month, i) => (
                  <option key={month} value={i + 1}>
                    {month}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {error && <ErrorBanner message={error} />}
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </form>
      )}
    </Card>
  );
}

/** Whether marking a part received has to say where it goes in the Inventory app. */
function InventoryOnReceive() {
  const names = useTeamNames();
  const inventory = names.appTitle("Inventory");
  const settings = useLoad(async () => {
    const res = await api.settings.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(required: boolean) {
    setBusy(true);
    setError(null);
    const res = await api.settings.$put({ json: { inventoryRequired: required } });
    setBusy(false);
    if (!res.ok) return setError(await getErrorMessage(res));
    forgetIntake();
    settings.reload();
  }

  return (
    <Card title="Receiving and Inventory">
      {!settings.data ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-secondary-900">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settings.data.inventoryRequired}
              disabled={busy}
              onChange={(e) => void set(e.target.checked)}
            />
            <span>
              <span className="font-semibold">
                Require a place in {inventory} when marking parts received
              </span>
              <span className="mt-0.5 block text-secondary-600">
                {settings.data.inventoryRequired
                  ? `Whoever receives a part must say where it goes, and it's added to ${inventory}.`
                  : `Optional. Parts received without a place aren't added to ${inventory}.`}
              </span>
            </span>
          </label>
          {error && <ErrorBanner message={error} />}
        </div>
      )}
    </Card>
  );
}

function NamingTemplate() {
  const settings = useLoad(async () => {
    const res = await api.settings.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [template, setTemplate] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data) setTemplate(settings.data.namingTemplate);
  }, [settings.data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const res = await api.settings.$put({ json: { namingTemplate: template } });
    if (!res.ok) return setError(await getErrorMessage(res));
    setSaved("Saved. New requests will be named this way.");
  }

  return (
    <Card title="Request names">
      {!settings.data ? (
        <Loading />
      ) : (
        <form onSubmit={save} className="space-y-3">
          <Field label="Template" hint="Tokens: {vendor} {sku} {title} {variant}.">
            <input
              className={`${inputClass} font-mono`}
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
          </Field>
          <p className="text-sm text-secondary-600">
            Example:{" "}
            <span className="font-semibold text-secondary-900">
              {applyTemplate(template || DEFAULT_TEMPLATE, EXAMPLE)}
            </span>
          </p>
          {error && <ErrorBanner message={error} />}
          {saved && <SuccessBanner message={saved} />}
          <div className="flex gap-2">
            <Button type="submit">Save</Button>
            <Button variant="secondary" onClick={() => setTemplate(DEFAULT_TEMPLATE)}>
              Reset to default
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function CategoryRules() {
  const rules = useLoad(async () => {
    const res = await api["category-rules"].$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const categories = useLoad(async () => {
    const res = await api.categories.$get({ query: {} });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).filter((c) => !c.isArchived);
  }, []);
  const [keyword, setKeyword] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const names = new Map((categories.data ?? []).map((c) => [c.id, c.name]));

  async function add(e: FormEvent) {
    e.preventDefault();
    const res = await api["category-rules"].$post({
      json: { keyword, categoryId: Number(categoryId) },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    setKeyword("");
    setError(null);
    rules.reload();
  }

  async function remove(id: number) {
    const res = await api["category-rules"][":id"].$delete({ param: { id: String(id) } });
    if (!res.ok) return setError(await getErrorMessage(res));
    rules.reload();
  }

  return (
    <Card title="Budget category guesses">
      <p className="text-sm text-secondary-600 mb-3">
        A new request's budget category comes from the product's last purchase, then the vendor's
        default, then these keywords.
      </p>
      {rules.data && rules.data.length > 0 && (
        <ul className="mb-3 divide-y divide-secondary-100 text-sm">
          {rules.data.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-1.5">
              <span className="font-mono text-secondary-900">{r.keyword}</span>
              <span className="text-secondary-400">→</span>
              <span className="text-secondary-700">
                {names.get(r.categoryId) ?? "Archived category"}
              </span>
              <button
                type="button"
                className="ml-auto text-xs underline text-secondary-500"
                onClick={() => remove(r.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          className={`${inputClass} sm:!w-48`}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Keyword (e.g. bolt)"
          required
          maxLength={40}
        />
        <select
          className={`${inputClass} sm:!w-72`}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          required
        >
          <option value="" disabled>
            Budget category…
          </option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button type="submit">Add rule</Button>
      </form>
      {error && (
        <div className="mt-3">
          <ErrorBanner message={error} />
        </div>
      )}
    </Card>
  );
}

/**
 * The team's Share-A-Cart account, which builds one-click Amazon carts. Connecting opens
 * Share-A-Cart's sign-in.
 */
function ShareACart() {
  const [params, setParams] = useSearchParams();
  const status = useLoad(async () => {
    const res = await api["share-a-cart"].status.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [error, setError] = useState<string | null>(params.get("sac_error"));
  const justConnected = params.get("sac") === "connected";
  // Clear the result Share-A-Cart's redirect left in the URL once it's shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on arrival
  useEffect(() => {
    if (params.has("sac") || params.has("sac_error")) setParams({}, { replace: true });
  }, []);

  async function disconnect() {
    if (!window.confirm("Disconnect the team's Share-A-Cart account?")) return;
    const res = await api["share-a-cart"].disconnect.$post();
    if (!res.ok) return setError(await getErrorMessage(res));
    status.reload();
  }

  const connectUrl = `${import.meta.env.VITE_API_BASE_URL ?? ""}/share-a-cart/connect`;
  return (
    <Card title="Share-A-Cart">
      <div className="space-y-3 text-sm">
        <p className="text-secondary-600">
          Builds one-click Amazon carts, saved to your Share-A-Cart account.
        </p>
        {justConnected && <SuccessBanner message="Share-A-Cart is connected." />}
        {error && <ErrorBanner message={error} />}
        {!status.data ? (
          <Loading />
        ) : status.data.connected ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-emerald-800">
              ✓ Connected
              {status.data.connectedBy ? ` by ${status.data.connectedBy}` : ""}
              {status.data.connectedAt
                ? ` on ${new Date(status.data.connectedAt).toLocaleDateString()}`
                : ""}
            </span>
            <Button variant="secondary" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        ) : (
          <a
            href={connectUrl}
            className="inline-block rounded-lg bg-primary-500 px-3.5 py-2 font-semibold text-white hover:bg-primary-600"
          >
            Connect the team's Share-A-Cart account
          </a>
        )}
      </div>
    </Card>
  );
}

/**
 * Trusted students: besides mentors, the only people who add catalog categories and add, edit
 * or delete catalog parts. The trusted ones show as chips; others are found by name (anyone who
 * has opened G3 Orders), so a team of 60 stays one line plus a search box.
 */
function TrustedStudents() {
  const names = useTeamNames();
  const people = useLoad(async () => {
    const res = await api.trusted.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function setTrusted(id: string, trusted: boolean) {
    setError(null);
    const res = await api.trusted[":id"].$put({ param: { id }, json: { trusted } });
    if (!res.ok) return setError(await getErrorMessage(res));
    setQuery("");
    people.reload();
  }

  const all = people.data ?? [];
  const trusted = all.filter((p) => p.trusted);
  const q = query.trim().toLowerCase();
  const matches = q
    ? all.filter((p) => !p.trusted && p.name.toLowerCase().includes(q)).slice(0, 6)
    : [];
  return (
    <Card title="Trusted students">
      <div className="space-y-3 text-sm">
        <p className="text-secondary-600">They can edit the catalog, like mentors.</p>
        {error && <ErrorBanner message={error} />}
        {!people.data ? (
          <Loading />
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {trusted.length === 0 && <span className="text-secondary-500">None yet.</span>}
              {trusted.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary-100 pl-3 pr-1 py-0.5 text-secondary-800"
                >
                  {p.name}
                  <button
                    type="button"
                    onClick={() => setTrusted(p.id, false)}
                    className="rounded-full px-1.5 text-secondary-400 hover:text-primary-600"
                    aria-label={`Remove ${p.name}`}
                    title="Remove"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <div className="relative max-w-sm">
              <input
                className={inputClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches.length === 1) setTrusted(matches[0].id, true);
                }}
                placeholder="Add a student by name…"
                aria-label="Add a trusted student"
              />
              {q && (
                <ul className="absolute z-10 mt-1 w-full rounded-lg border border-secondary-200 bg-surface shadow-lg">
                  {matches.length === 0 ? (
                    <li className="px-3 py-2 text-secondary-500">
                      No one by that name has opened {names.appTitle("Orders")} yet.
                    </li>
                  ) : (
                    matches.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => setTrusted(p.id, true)}
                          className="w-full px-3 py-2 text-left hover:bg-secondary-50"
                        >
                          {p.name}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
