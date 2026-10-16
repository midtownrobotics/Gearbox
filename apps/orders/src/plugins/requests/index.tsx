import type { Plugin } from "../../shared/plugin-types";
import { RequestDetailPage } from "./request-detail-page";
import { ApprovalsPage, RequestsPage } from "./requests-page";
import { WishlistPage } from "./wishlist-page";

export const requestsPlugin: Plugin = {
  name: "requests",
  routes: [
    { path: "/requests", element: <RequestsPage /> },
    { path: "/requests/:id", element: <RequestDetailPage /> },
    { path: "/approvals", element: <ApprovalsPage /> },
    { path: "/wishlist", element: <WishlistPage /> },
  ],
  navItems: [
    { label: "Requests", to: "/requests", order: 10 },
    { label: "Wishlist", to: "/wishlist", order: 36.5 },
    { label: "Approvals", to: "/approvals", order: 30, mentorOnly: true },
  ],
};
