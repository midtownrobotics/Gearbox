// SPDX-License-Identifier: AGPL-3.0-only
import { adminPlugin } from "./plugins/admin";
import { leaderboardPlugin } from "./plugins/leaderboard";
import { myAttendancePlugin } from "./plugins/me";
import { qrCodesPlugin } from "./plugins/qr-codes";

export const plugins = [leaderboardPlugin, myAttendancePlugin, qrCodesPlugin, adminPlugin];
