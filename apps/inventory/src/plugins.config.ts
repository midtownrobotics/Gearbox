// SPDX-License-Identifier: AGPL-3.0-only
import { entryPlugin } from "./plugins/entry";
import { locationsPlugin } from "./plugins/locations";
import { settingsPlugin } from "./plugins/settings";
import { tablePlugin } from "./plugins/table";

export const plugins = [tablePlugin, locationsPlugin, entryPlugin, settingsPlugin];
