import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getErrorMessage } from "../../shared/api";
import { useAuthUser } from "../../shared/auth";
import type { RequestListRow } from "../../shared/types";
import { ErrorBanner, Loading, Page, SuccessBanner, inputClass } from "../../shared/ui";
import { useLoad } from "../../shared/use-load";
import { requestSearch } from "../lists/search";
import { RequestTable } from "./requests-page";

// Parts someone would like one day. They aren't requests (the Requests page, budgets and lists
// leave them out) until anyone promotes one: it's then a request from whoever promoted it.
// Anyone adds, edits, promotes and removes them (from the table's rows or the item's page).

const rowButton =
  "rounded-md border border-secondary-300 bg-surface px-2 py-0.5 text-xs font-semibold text-secondary-800 hover:bg-secondary-50 disabled:opacity-50";

/** Promotes a wishlist item to a request by the signed-in member. */
export async function promote(id: number) {
  const res = await api.requests[":id"].promote.$post({ param: { id: String(id) } });
  if (!res.ok) throw new Error(await getErrorMessage(res));
}

/** Removes a wishlist item. */
export async function removeWish(id: number) {
  const res = await api.requests[":id"].$delete({ param: { id: String(id) } });
  if (!res.ok) throw new Error(await getErrorMessage(res));
}

/** The wishlist as the requests table, newest first; a row opens the item's page. */
export function WishlistPage() {
  const user = useAuthUser();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, reload } = useLoad(async () => {
    const res = await api.requests.$get({ query: { status: "wishlist" } });
    if (!res.ok) throw new Error(await getErrorMessage(res));
    return (await res.json()).sort((a, b) => b.createdAt - a.createdAt);
  }, []);
  const [query, setQuery] = useState("");
  const find = useMemo(() => requestSearch(data ?? []), [data]);
  const shown = find(query);

  async function act(item: RequestListRow, action: "promote" | "remove") {
    const question =
      action === "promote"
        ? `Request ${item.title}? It goes to the mentors as your request.`
        : `Remove ${item.title} from the wishlist?`;
    if (!window.confirm(question)) return;
    setBusy(item.id);
    setActionError(null);
    try {
      if (action === "promote") {
        await promote(item.id);
        navigate(`/requests/${item.id}`);
        return;
      }
      await removeWish(item.id);
      setMessage(`Removed ${item.title} from the wishlist.`);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page
      title="Wishlist"
      wide
      actions={
        <Link
          to="/new?wishlist=1"
          className="rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-700"
        >
          Add parts
        </Link>
      }
    >
      <p className="text-sm text-secondary-500">
        Parts we'd like one day. They aren't requested until someone promotes one from its page: it
        then goes to the mentors as that person's request.
      </p>
      <input
        type="search"
        className={inputClass}
        placeholder="Search the wishlist…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search the wishlist"
      />
      {message && <SuccessBanner message={message} />}
      {(error || actionError) && <ErrorBanner message={(error || actionError) as string} />}
      {!data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <p className="text-sm text-secondary-500">
          {query ? "No parts match." : "Nothing on the wishlist yet."}
        </p>
      ) : (
        <RequestTable
          sections={[{ key: "wishlist", rows: shown }]}
          userId={user.userId}
          wishlist
          actions={(item) => (
            <>
              <button
                type="button"
                className={rowButton}
                disabled={busy !== null}
                onClick={() => void act(item, "promote")}
              >
                {busy === item.id ? "…" : "Promote"}
              </button>
              <button
                type="button"
                className={rowButton}
                disabled={busy !== null}
                onClick={() => void act(item, "remove")}
              >
                Remove
              </button>
            </>
          )}
        />
      )}
    </Page>
  );
}
