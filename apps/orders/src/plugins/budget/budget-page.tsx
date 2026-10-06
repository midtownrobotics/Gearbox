import { fiscalLabel } from "@g3/worker-orders/fiscal";
import { type FormEvent, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import { ExportCsvButton } from "../../shared/export-csv";
import { formatCents, parseDollars } from "../../shared/format";
import type { Category } from "../../shared/types";
import { Button, Card, ErrorBanner, Loading, Page, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { ImportSheet } from "./import-sheet";

const SEGMENTS = [
  { key: "spentCents", label: "Spent", className: "bg-meter-spent" },
  {
    key: "committedCents",
    label: "Approved, not ordered (not counted yet)",
    className: "bg-meter-committed",
  },
  {
    key: "pendingCents",
    label: "Awaiting approval (not counted yet)",
    className: "bg-meter-pending",
  },
] as const;

/**
 * Spending per budget category for one fiscal year (July–June): the summary table, then each
 * category's bar. Mentors add, rename, set each year's budget, archive, import and export.
 */
export function BudgetPage() {
  const user = useAuthUser();
  const years = useLoad(async () => {
    const res = await api.categories.years.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [picked, setPicked] = useState<number | null>(null);
  const fy = picked ?? years.data?.current ?? null;
  const isCurrent = fy !== null && fy === years.data?.current;
  const { data, error, reload } = useLoad(async () => {
    if (fy === null) return null;
    const res = await api.categories.$get({ query: { fy: String(fy) } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, [fy]);

  // Archived categories still show in a year they have a budget or spending in.
  const shown =
    data?.filter((c) => !c.isArchived || c.budgetCents !== null || c.spentCents > 0) ?? [];
  const active = data?.filter((c) => !c.isArchived) ?? [];
  const archived = data?.filter((c) => c.isArchived) ?? [];
  const refresh = () => {
    reload();
    years.reload();
  };

  return (
    <Page
      title="Budget"
      actions={
        <div className="flex items-center gap-2">
          {years.data && (
            <select
              className={`${inputClass} !w-auto !py-1.5`}
              value={fy ?? ""}
              onChange={(e) => setPicked(Number(e.target.value))}
              aria-label="Fiscal year"
            >
              {years.data.years.map((y) => (
                <option key={y} value={y}>
                  FY {fiscalLabel(y)}
                  {y === years.data?.current ? " (current)" : ""}
                </option>
              ))}
            </select>
          )}
          {user.isMentor && fy !== null && <ExportCsvButton fiscalYear={fy} />}
        </div>
      }
    >
      {(error || years.error) && <ErrorBanner message={(error ?? years.error) as string} />}
      {!data || fy === null ? (
        <Loading />
      ) : (
        <>
          <SummaryTable categories={shown} fiscalYear={fy} />
          {user.isMentor && <AddCategory fiscalYear={fy} onAdded={refresh} />}
          {user.isMentor && <ImportSheet onImported={refresh} />}
          {active.length === 0 ? (
            <p className="text-sm text-secondary-500">
              No budget categories yet.
              {user.isMentor ? " Add one above." : " A mentor needs to add one."}
            </p>
          ) : (
            <Card>
              <div className="flex flex-wrap gap-4 mb-4 text-xs text-secondary-600">
                {SEGMENTS.filter((seg) => isCurrent || seg.key === "spentCents").map((seg) => (
                  <span key={seg.key} className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-sm ${seg.className}`} aria-hidden />
                    {seg.label}
                  </span>
                ))}
              </div>
              <div className="divide-y divide-secondary-100">
                {active.map((c) => (
                  <CategoryRow
                    key={c.id}
                    category={c}
                    canEdit={user.isMentor}
                    showOpen={isCurrent}
                    onChanged={refresh}
                  />
                ))}
              </div>
            </Card>
          )}
          {archived.length > 0 && (
            <Card title="Archived">
              <div className="divide-y divide-secondary-100">
                {archived.map((c) => (
                  <CategoryRow
                    key={c.id}
                    category={c}
                    canEdit={user.isMentor}
                    showOpen={isCurrent}
                    onChanged={refresh}
                  />
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

/** "Fall Consumables - 4101" → "Fall Consumables" when the code is shown in its own column. */
function description(c: Category) {
  if (!c.code) return c.name;
  return c.name.replace(new RegExp(`\\s*[-–—:]\\s*${c.code}$`), "").trim() || c.name;
}

/** The budget sheet's summary: spend to date against each category's budget for the year. */
function SummaryTable({ categories, fiscalYear }: { categories: Category[]; fiscalYear: number }) {
  const rows = [...categories].sort((a, b) =>
    (a.code ?? a.name).localeCompare(b.code ?? b.name, undefined, { numeric: true }),
  );
  const spent = rows.reduce((n, c) => n + c.spentCents, 0);
  const budget = rows.reduce((n, c) => n + (c.budgetCents ?? 0), 0);
  const pct = (s: number, b: number | null) => (b ? `${Math.round((100 * s) / b)}%` : "—");
  const remaining = (s: number, b: number | null) => (b === null ? null : b - s);
  const money = (cents: number | null) =>
    cents === null ? "—" : cents < 0 ? `-${formatCents(-cents)}` : formatCents(cents);
  const over = (s: number, b: number | null) => b !== null && s > b;

  return (
    <Card title={`General expenses · FY ${fiscalLabel(fiscalYear)}`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-secondary-500 border-b border-secondary-200">
              <th className="py-2 pr-3 font-semibold text-left">Budget Category</th>
              <th className="py-2 pr-3 font-semibold text-left">Line Item Description</th>
              <th className="py-2 pr-3 font-semibold text-right">Spend To Date</th>
              <th className="py-2 pr-3 font-semibold text-right">Budget</th>
              <th className="py-2 pr-3 font-semibold text-right">% of Budget</th>
              <th className="py-2 font-semibold text-right">Remaining Budget</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-secondary-100">
                <td className="py-1.5 pr-3 font-mono text-secondary-700">{c.code ?? "—"}</td>
                <td className="py-1.5 pr-3 text-secondary-900">{description(c)}</td>
                <td className="py-1.5 pr-3 text-right">{formatCents(c.spentCents)}</td>
                <td className="py-1.5 pr-3 text-right">{money(c.budgetCents)}</td>
                <td
                  className={`py-1.5 pr-3 text-right ${over(c.spentCents, c.budgetCents) ? "text-primary-700 font-semibold" : ""}`}
                >
                  {pct(c.spentCents, c.budgetCents)}
                </td>
                <td
                  className={`py-1.5 text-right ${over(c.spentCents, c.budgetCents) ? "text-primary-700 font-semibold" : ""}`}
                >
                  {over(c.spentCents, c.budgetCents) && <span aria-hidden>⚠ </span>}
                  {money(remaining(c.spentCents, c.budgetCents))}
                </td>
              </tr>
            ))}
            <tr className="font-semibold text-secondary-900">
              <td className="py-2 pr-3" />
              <td className="py-2 pr-3">Total</td>
              <td className="py-2 pr-3 text-right">{formatCents(spent)}</td>
              <td className="py-2 pr-3 text-right">{formatCents(budget)}</td>
              <td className="py-2 pr-3 text-right">{pct(spent, budget || null)}</td>
              <td className={`py-2 text-right ${spent > budget ? "text-primary-700" : ""}`}>
                {money(budget - spent)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CategoryRow({
  category,
  canEdit,
  showOpen,
  onChanged,
}: {
  category: Category;
  canEdit: boolean;
  /** Show approved/awaiting amounts (open requests belong to the current year only). */
  showOpen: boolean;
  onChanged: () => void;
}) {
  const c = showOpen ? category : { ...category, committedCents: 0, pendingCents: 0 };
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = c.spentCents + c.committedCents + c.pendingCents;
  const scale = Math.max(c.budgetCents ?? 0, total, 1);
  // Only placed orders count against the budget; approved/pending are shown as what's coming.
  const over = c.budgetCents !== null && c.spentCents > c.budgetCents;
  const segments = SEGMENTS.filter((s) => c[s.key] > 0);

  async function setArchived(isArchived: boolean) {
    const res = await api.categories[":id"].$patch({
      param: { id: String(c.id) },
      json: { isArchived },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    onChanged();
  }

  return (
    <div className="py-4 first:pt-0 last:pb-0 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-secondary-900">
          {c.name}
          {c.code && <span className="ml-2 font-mono text-xs text-secondary-500">{c.code}</span>}
        </h3>
        <p className="text-sm text-secondary-600 tabular-nums">
          {formatCents(c.spentCents)} spent
          {c.committedCents > 0 && ` · ${formatCents(c.committedCents)} approved`}
          {c.pendingCents > 0 && ` · ${formatCents(c.pendingCents)} awaiting`}
          {c.budgetCents !== null ? ` of ${formatCents(c.budgetCents)}` : " · no budget set"}
        </p>
      </div>
      <div
        className="relative h-3 w-full rounded bg-secondary-100 flex gap-0.5 overflow-hidden"
        role="img"
        aria-label={`${c.name}: ${formatCents(c.spentCents)} spent, ${formatCents(c.committedCents)} approved, ${formatCents(c.pendingCents)} awaiting approval${c.budgetCents !== null ? `, budget ${formatCents(c.budgetCents)}` : ""}`}
      >
        {segments.map((s, i) => (
          <div
            key={s.key}
            title={`${s.label}: ${formatCents(c[s.key])}`}
            className={`h-full ${s.className} ${i === segments.length - 1 ? "rounded-r" : ""}`}
            style={{ width: `${(100 * c[s.key]) / scale}%` }}
          />
        ))}
      </div>
      {c.budgetCents !== null && (
        <p className={`text-xs ${over ? "text-primary-700 font-semibold" : "text-secondary-500"}`}>
          {over
            ? `⚠ Over budget by ${formatCents(c.spentCents - c.budgetCents)}`
            : `${formatCents(c.budgetCents - c.spentCents)} left${
                c.committedCents > 0
                  ? ` (${formatCents(c.budgetCents - c.spentCents - c.committedCents)} once approved items are ordered)`
                  : ""
              }`}
        </p>
      )}
      {canEdit &&
        (editing ? (
          <EditCategory
            category={c}
            onDone={() => {
              setEditing(false);
              onChanged();
            }}
          />
        ) : (
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              className="text-secondary-500 hover:text-secondary-900 underline"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              className="text-secondary-500 hover:text-secondary-900 underline"
              onClick={() => setArchived(!c.isArchived)}
            >
              {c.isArchived ? "Unarchive" : "Archive"}
            </button>
          </div>
        ))}
      {error && <ErrorBanner message={error} />}
    </div>
  );
}

function EditCategory({ category, onDone }: { category: Category; onDone: () => void }) {
  const [name, setName] = useState(category.name);
  const [code, setCode] = useState(category.code ?? "");
  const [budget, setBudget] = useState(
    category.budgetCents === null ? "" : (category.budgetCents / 100).toFixed(2),
  );
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const budgetCents = parseDollars(budget);
    if (Number.isNaN(budgetCents)) return setError("Budget must be a dollar amount like 500.");
    const res = await api.categories[":id"].$patch({
      param: { id: String(category.id) },
      json: { name, code: code.trim() || null, budgetCents, fiscalYear: category.fiscalYear },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    onDone();
  }

  return (
    <form onSubmit={save} className="flex flex-wrap gap-2 items-start">
      <input
        className={`${inputClass} sm:w-56`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        maxLength={60}
      />
      <input
        className={`${inputClass} sm:w-32`}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Code (e.g. 4101)"
        maxLength={20}
        title="Accounting code shown in the CSV export's Budget Category column"
      />
      <input
        className={`${inputClass} sm:w-40`}
        inputMode="decimal"
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        placeholder={`FY ${fiscalLabel(category.fiscalYear)} budget`}
      />
      <Button type="submit">Save</Button>
      <Button variant="secondary" onClick={onDone}>
        Cancel
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}

function AddCategory({ fiscalYear, onAdded }: { fiscalYear: number; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    const budgetCents = parseDollars(budget);
    if (Number.isNaN(budgetCents)) return setError("Budget must be a dollar amount like 500.");
    const res = await api.categories.$post({
      json: { name, code: code.trim() || null, budgetCents, fiscalYear },
    });
    if (!res.ok) return setError(await getErrorMessage(res));
    setName("");
    setCode("");
    setBudget("");
    setError(null);
    onAdded();
  }

  return (
    <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
      <input
        className={inputClass}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New category (e.g. Drivetrain, Tools, Outreach)"
        required
        maxLength={60}
      />
      <input
        className={`${inputClass} sm:w-32`}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Code (e.g. 4101)"
        maxLength={20}
        title="Accounting code shown in the CSV export's Budget Category column"
      />
      <input
        className={`${inputClass} sm:w-48`}
        inputMode="decimal"
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        placeholder={`FY ${fiscalLabel(fiscalYear)} budget`}
      />
      <Button type="submit" className="shrink-0">
        Add category
      </Button>
      {error && <ErrorBanner message={error} />}
    </form>
  );
}
