import type { Plugin } from "../../shared/plugin-types";
import { QrCodesPage } from "./qr-codes-page";

export const qrCodesPlugin: Plugin = {
  name: "qr-codes",
  routes: [{ path: "/qr-codes", element: <QrCodesPage />, adminOnly: true }],
  navItems: [{ label: "QR Codes", to: "/qr-codes", order: 20, adminOnly: true }],
};
