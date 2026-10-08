import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Page } from "../../shared/ui";
import { useRequestComposer } from "./request-composer";

/** Where a page that opens /request came from, so it goes back there when it's done. */
export type RequestFrom = { from?: string };

/** What /request says to the page it returns to (shown there as a banner). */
export type RequestDone = { requestMessage?: string };

/**
 * One request (or wishlist part), on its own page, with no search or link box of its own: the
 * New Request page's search box opens it for a pasted link (`?urls=`) or a picked part
 * (`?catalog=`), and "Add a part by hand" opens it empty. Submitting or cancelling goes back to
 * where it was opened from (the New Request page, a catalog part, a list, the wishlist).
 */
export function RequestPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const wishlist = params.get("wishlist") === "1";
  const list = params.get("list");
  const from =
    (location.state as RequestFrom | null)?.from ??
    (wishlist ? "/wishlist" : list ? `/lists/${list}` : "/catalog");
  const leave = (message?: string) =>
    navigate(from, { replace: true, state: message ? { requestMessage: message } : undefined });
  const composer = useRequestComposer({ onDone: leave, onCancel: () => leave() });

  return (
    <Page
      title={wishlist ? "Add to Wishlist" : "New Request"}
      actions={
        <button
          type="button"
          onClick={() => leave()}
          className="text-sm text-secondary-500 hover:text-secondary-800"
        >
          ← Cancel
        </button>
      }
    >
      {composer.view}
    </Page>
  );
}
