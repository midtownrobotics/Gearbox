// SPDX-License-Identifier: AGPL-3.0-only
import { accountPlugin } from "./plugins/account";
import { adminPlugin } from "./plugins/admin";
import { homePlugin } from "./plugins/home";

export const plugins = [homePlugin, accountPlugin, adminPlugin];
