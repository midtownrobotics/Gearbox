import { Navigate, useSearchParams } from "react-router-dom";
import type { Plugin } from "../../shared/plugin-types";
import { RequestPage } from "../requests/request-page";
import { CatalogPage } from "./catalog-page";
import { CatalogItemPage } from "./item-page";

/**
 * /new, from before New Request was the catalog: a link or a picked part (?urls=, ?catalog=) is
 * the request page; anything else (?list=, ?wishlist=1) the catalog.
 */
function OldNewRequest() {
  const [params] = useSearchParams();
  const to = params.has("urls") || params.has("catalog") ? "/request" : "/catalog";
  return <Navigate to={`${to}?${params}`} replace />;
}

export const catalogPlugin: Plugin = {
  name: "catalog",
  routes: [
    { path: "/catalog", element: <CatalogPage /> },
    { path: "/request", element: <RequestPage /> },
    { path: "/new", element: <OldNewRequest /> },
    { path: "/catalog/items/:id", element: <CatalogItemPage /> },
  ],
  navItems: [{ label: "New Request", to: "/catalog", order: 20 }],
};
