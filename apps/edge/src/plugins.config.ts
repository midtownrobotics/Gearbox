// SPDX-License-Identifier: AGPL-3.0-only
import { boxPlugin } from "./plugins/box";
import { drivePlugin } from "./plugins/drive";
import { networkPlugin } from "./plugins/network";
import { printPlugin } from "./plugins/print";
import { switchPlugin } from "./plugins/switch";

export const plugins = [networkPlugin, printPlugin, drivePlugin, switchPlugin, boxPlugin];
