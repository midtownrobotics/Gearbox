import { accountPlugin } from "./plugins/account";
import { adminPlugin } from "./plugins/admin";
import { homePlugin } from "./plugins/home";
import { usersPlugin } from "./plugins/users";

export const plugins = [homePlugin, accountPlugin, usersPlugin, adminPlugin];
