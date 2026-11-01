// SPDX-License-Identifier: AGPL-3.0-only
import type { Plugin } from "../../shared/plugin-types";
import { KioskActivatePage } from "./kiosk-activate-page";
import { KioskLoginPage } from "./kiosk-login-page";
import { KioskRemovePage } from "./kiosk-remove-page";

export const kioskPlugin: Plugin = {
  name: "kiosk",
  routes: [
    { path: "/kiosk/activate", element: <KioskActivatePage /> },
    { path: "/kiosk/login", element: <KioskLoginPage /> },
    { path: "/kiosk/remove", element: <KioskRemovePage /> },
  ],
};
