import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import type { CatalogItem } from "../../shared/types";
import { Button, Card, ErrorBanner, Field, Page, SuccessBanner, inputClass } from "../../shared/ui";
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

const LINK = /https?:\/\/[^\s<>"']+/g;

/** Runs `fn` over items with at most `limit` in flight (lookups go out through the shop box). */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

/**
 * Fast entry: paste one or more product links (one per line). Each becomes a row filled in by the
 * lookup, named by the team template, with a budget category guess and the product's purchase
 * history. Rows can also be added by hand; everything is submitted together.
 */
export function NewRequestPage() {
  const [params, setParams] = useSearchParams();
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
  const lists = useLoad(async () => {
    const res = await api.lists.$get();
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).filter((l) => !l.isArchived);
  }, []);
  // Arriving from a list (?list=…) puts everything submitted here on it.
  const [listId, setListId] = useState(() => params.get("list") ?? "");
  const listName = lists.data?.find((l) => String(l.id) === listId)?.name;

  const [links, setLinks] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [sharedReason, setSharedReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  async function fill(draft: Draft) {
    update(draft.key, await lookUpDraft(draft.url));
  }

  async function lookUp(text = links) {
    const urls = [...new Set(text.match(LINK) ?? [])];
    if (urls.length === 0) return setError("Paste at least one link (starting with http).");
    setError(null);
    setSubmitted(null);
    const fresh = urls.map((u) => ({ ...blank(u), state: "loading" as const }));
    setDrafts((all) => [...all.filter((d) => d.url || d.name), ...fresh]);
    setLinks("");
    await eachLimited(fresh, 3, fill);
  }

  /** Rows for parts picked in the catalog (?catalog=1,2,3). */
  async function fromCatalog(ids: string) {
    setError(null);
    const res = await api.catalog.items.$get({ query: { ids } });
    if (!res.ok) return setError(await getErrorMessage(res));
    await addCatalogItems(await res.json());
  }

  /** Rows for catalog parts: filled from the catalog (looked up again if the price is old). */
  async function addCatalogItems(items: CatalogItem[]) {
    setSubmitted(null);
    const rows = items.map((item) => ({
      item,
      draft: { ...blank(item.url), name: item.name, state: "loading" as const },
    }));
    setDrafts((all) => [...all.filter((d) => d.url || d.name), ...rows.map((r) => r.draft)]);
    await eachLimited(rows, 3, async ({ item, draft }) =>
      update(draft.key, await catalogDraft(item)),
    );
  }

  // Links handed over in the address (?urls=…) or parts picked in the Catalog (?catalog=…) are
  // filled in right away.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on arrival
  useEffect(() => {
    const handed = params.get("urls");
    const picked = params.get("catalog");
    if ((!handed && !picked) || started.current) return;
    started.current = true;
    setParams(listId ? { list: listId } : {}, { replace: true });
    if (handed) void lookUp(handed);
    if (picked) void fromCatalog(picked);
  }, []);

  function pickVariant(d: Draft, id: string) {
    const patch = variantPatch(d, id, settings.data?.namingTemplate);
    if (patch) update(d.key, patch);
  }

  async function submitAll() {
    const ready = drafts.filter((d) => d.state === "ready");
    if (ready.length === 0) return;
    setBusy(true);
    setError(null);
    let done = 0;
    const failed: Draft[] = [];
    for (const d of ready) {
      const problem = draftProblem(d, sharedReason);
      if (problem) {
        failed.push({ ...d, submitError: problem });
        continue;
      }
      const res = await api.requests.$post({
        json: { ...draftFields(d, sharedReason), listId: listId ? Number(listId) : null },
      });
      if (res.ok) done++;
      else failed.push({ ...d, submitError: await getErrorMessage(res) });
    }
    setBusy(false);
    setDrafts([...failed, ...drafts.filter((d) => d.state === "loading")]);
    if (done > 0) {
      setSubmitted(
        `${done === 1 ? "Your request was" : `${done} requests were`} submitted for review${
          listName ? ` and added to ${listName}` : ""
        }.${failed.length ? ` ${failed.length} still need attention below.` : ""}`,
      );
      if (failed.length === 0) setSharedReason("");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const onLinksKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void lookUp();
    }
  };
  const readyCount = drafts.filter((d) => d.state === "ready").length;

  return (
    <Page
      title="New Request"
      actions={
        listName && (
          <Link
            to={`/lists/${listId}`}
            className="text-sm text-secondary-500 hover:text-secondary-800"
          >
            ← Back to {listName}
          </Link>
        )
      }
    >
      {submitted && <SuccessBanner message={submitted} />}
      <div className="space-y-2">
        <CatalogSearch
          onPick={(item) => void addCatalogItems([item])}
          placeholder='Find a part in the catalog: "1/2 hex bearing", "WCP-0320"…'
        />
        <textarea
          className={`${inputClass} min-h-20`}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          onKeyDown={onLinksKey}
          placeholder="…or paste product links, one per line (WCP, REV, AndyMark, Amazon, McMaster, …)"
          aria-label="Product links"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => lookUp()} disabled={!links.trim()}>
            Look up
          </Button>
          <Button variant="secondary" onClick={() => setDrafts((all) => [...all, blank()])}>
            Add by hand
          </Button>
          <span className="hidden sm:inline text-xs text-secondary-400">Ctrl+Enter to look up</span>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {categories.data?.length === 0 && (
        <p className="text-sm text-secondary-500">
          No budget categories yet. A mentor needs to add one on the{" "}
          <Link to="/budget" className="underline">
            Budget
          </Link>{" "}
          page.
        </p>
      )}

      {drafts.map((d) => (
        <DraftCard
          key={d.key}
          draft={d}
          categories={categories.data ?? []}
          catalogCategories={catalogCategories.data ?? []}
          onCategoryAdded={catalogCategories.reload}
          onChange={(patch) => update(d.key, patch)}
          onVariant={(id) => pickVariant(d, id)}
          onRemove={() => setDrafts((all) => all.filter((x) => x.key !== d.key))}
        />
      ))}

      {drafts.length > 0 && (
        <Card>
          <div className="space-y-3">
            {drafts.length > 1 && (
              <Field
                label="Why do we need these?"
                hint="Used for every item without its own reason"
              >
                <textarea
                  className={`${inputClass} min-h-16`}
                  value={sharedReason}
                  onChange={(e) => setSharedReason(e.target.value)}
                  maxLength={1000}
                />
              </Field>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-secondary-500">
                You'll get a Slack DM when a mentor approves each one.
              </p>
              <div className="flex items-center gap-2">
                {(lists.data?.length ?? 0) > 0 && (
                  <select
                    className="rounded-lg border border-secondary-300 bg-white px-3 py-2 text-sm text-secondary-700 focus:outline-none focus:border-primary-500"
                    value={listId}
                    onChange={(e) => setListId(e.target.value)}
                    aria-label="List"
                  >
                    <option value="">No list</option>
                    {lists.data?.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
                <Button onClick={submitAll} disabled={busy || readyCount === 0}>
                  {busy
                    ? "Submitting…"
                    : readyCount > 1
                      ? `Submit all ${readyCount}`
                      : "Submit request"}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}
    </Page>
  );
}
