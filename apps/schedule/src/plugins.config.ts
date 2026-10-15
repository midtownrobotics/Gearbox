import { adminPlugin } from "./plugins/admin";
import { rolesPlugin } from "./plugins/roles";
import { schedulesPlugin } from "./plugins/schedules";

export const plugins = [schedulesPlugin, rolesPlugin, adminPlugin];
