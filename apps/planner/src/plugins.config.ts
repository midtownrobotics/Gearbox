// SPDX-License-Identifier: AGPL-3.0-only
import { adminPlugin } from "./plugins/admin";
import { boardPlugin } from "./plugins/board";
import { calendarPlugin } from "./plugins/calendar";

export const plugins = [boardPlugin, calendarPlugin, adminPlugin];
