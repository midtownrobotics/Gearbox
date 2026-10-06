import { budgetPlugin } from "./plugins/budget";
import { catalogPlugin } from "./plugins/catalog";
import { listsPlugin } from "./plugins/lists";
import { orderingPlugin } from "./plugins/ordering";
import { receivingPlugin } from "./plugins/receiving";
import { requestsPlugin } from "./plugins/requests";
import { settingsPlugin } from "./plugins/settings";
import { vendorsPlugin } from "./plugins/vendors";

export const plugins = [
  catalogPlugin,
  requestsPlugin,
  listsPlugin,
  orderingPlugin,
  receivingPlugin,
  vendorsPlugin,
  budgetPlugin,
  settingsPlugin,
];
