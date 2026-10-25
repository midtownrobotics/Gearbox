import { Button, Dialog, ErrorBanner, TextField } from "@g3/ui";
import { type FormEvent, useState } from "react";
import { api, getErrorMessage } from "../../shared/api";
import { formatCents, msToDateInput } from "../../shared/format";
import type { CatalogItem, OrderRequest } from "../../shared/types";
import { useLoad } from "../../shared/use-load";
import { CatalogSearch } from "../catalog/catalog-search";
import {
  type Draft,
  DraftCard,
  blank,
  catalogDraft,
  draftFields,
  draftProblem,
  lookUpDraft,
  variantPatch,
} from "./draft";

/**
 * Lets a mentor swap a request's item for another (wrong supplier, wrong part): pick it from the
 * catalog or paste its link, and it's filled in like a new request, keeping the quantity, budget
 * category, priority, need-by and reason. Everything can be changed before saving; the request
 * keeps its id and requester.
 */
export function ReplaceItem({
  request,
  onReplaced,
}: {
  request: OrderRequest;
  onReplaced: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Replace item
      </Button>
      {open && (
        <ReplaceDialog
          request={request}
          onClose={() => setOpen(false)}
          onReplaced={() => {
            setOpen(false);
            onReplaced();
          }}
        />
      )}
    </>
  );
}

function ReplaceDialog({
  request,
  onClose,
  onReplaced,
}: {
  request: OrderRequest;
  onClose: () => void;
  onReplaced: () => void;
}) {
  const categories = useLoad(async () => {
    const res = await api.categories.$get({ query: {} });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).filter((c) => !c.isArchived);
  }, []);
  const catalogCategories = useLoad(async () => {
    const res = await api.catalog.categories.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const settings = useLoad(async () => {
    const res = await api.settings.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return res.json();
  }, []);
  const [link, setLink] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Replace item was clicked while something was missing: say what. */
  const [showWhy, setShowWhy] = useState(false);

  const change = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  // What the requester chose stays; the item details come from the replacement.
  const kept: Partial<Draft> = {
    quantity: String(request.quantity),
    categoryId: String(request.categoryId),
    categoryHint: null,
    priority: request.priority,
    needBy: request.needBy === null ? "" : msToDateInput(request.needBy),
    reason: request.reason,
  };

  async function fill(start: Draft, find: () => Promise<Partial<Draft>>) {
    setError(null);
    setDraft({ ...start, ...kept, state: "loading" });
    const found = await find();
    setDraft((d) => (d ? { ...d, ...found, ...kept } : d));
  }

  function fromLink(e: FormEvent) {
    e.preventDefault();
    const url = link.trim();
    if (!/^https?:\/\//.test(url)) return setError("Paste a product link (starting with http).");
    void fill(blank(url), () => lookUpDraft(url));
  }

  function fromCatalog(item: CatalogItem) {
    void fill({ ...blank(item.url), name: item.name }, () => catalogDraft(item));
  }

  /** What has to be fixed before the item can be replaced. */
  const whyBlocked = !draft
    ? "Paste a link or pick a part from the catalog first."
    : draft.state !== "ready"
      ? "Wait for the lookup to finish."
      : draftProblem(draft);

  async function save() {
    if (whyBlocked || !draft) return setShowWhy(true);
    setShowWhy(false);
    setBusy(true);
    change({ submitError: null });
    const res = await api.requests[":id"].$patch({
      param: { id: String(request.id) },
      json: draftFields(draft),
    });
    setBusy(false);
    if (!res.ok) return change({ submitError: await getErrorMessage(res) });
    onReplaced();
  }

  return (
    <Dialog title="Replace item" size="3xl" onClose={onClose}>
      <>
        <section>
          <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">
            Currently
          </p>
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-secondary-200 bg-secondary-50 p-3">
            {request.image ? (
              <img
                src={request.image}
                alt=""
                className="h-12 w-12 shrink-0 rounded-md bg-surface object-contain"
              />
            ) : (
              <div className="h-12 w-12 shrink-0 rounded-md bg-secondary-100" aria-hidden />
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-secondary-900 line-clamp-2">
                {request.quantity}× {request.title}
              </p>
              <p className="text-xs text-secondary-500">
                {request.vendor}
                {request.sku && ` · ${request.sku}`}
                {request.unitPriceCents !== null &&
                  ` · ${formatCents(request.unitPriceCents, request.currency)} each`}
                {" · requested by "}
                {request.requesterName}
              </p>
            </div>
            {request.url && (
              <a
                href={request.url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs text-secondary-500 hover:text-primary-600"
              >
                Link ↗
              </a>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-secondary-400">
            Replace with
          </p>
          {!draft ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-secondary-700">From the catalog</p>
                <CatalogSearch
                  onPick={fromCatalog}
                  placeholder='e.g. "1/2 hex bearing"'
                  autoFocus
                />
              </div>
              <form onSubmit={fromLink} className="space-y-1">
                <p className="text-sm font-semibold text-secondary-700">Or paste a link</p>
                <div className="flex gap-2">
                  <TextField
                    kind="url"
                    className="min-w-0 flex-1"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://…"
                    aria-label="Replacement product link"
                  />
                  <Button type="submit" disabled={!link.trim()}>
                    Look up
                  </Button>
                </div>
              </form>
              {error && (
                <div className="sm:col-span-2">
                  <ErrorBanner message={error} />
                </div>
              )}
            </div>
          ) : (
            <DraftCard
              draft={draft}
              categories={categories.data ?? []}
              catalogCategories={catalogCategories.data ?? []}
              onCategoryAdded={catalogCategories.reload}
              onChange={change}
              onVariant={(id) => {
                const patch = variantPatch(draft, id, settings.data?.namingTemplate);
                if (patch) change(patch);
              }}
              onRemove={() => setDraft(null)}
              removeLabel="Pick a different item"
            />
          )}
        </section>

        {showWhy && whyBlocked && (
          <p role="alert" className="text-right text-sm text-red-700">
            {whyBlocked}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-secondary-200 pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy} blocked={!!whyBlocked}>
            {busy ? "Saving…" : "Replace item"}
          </Button>
        </div>
      </>
    </Dialog>
  );
}
