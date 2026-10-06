import type { Plugin } from "../../shared/plugin-types";
import { BudgetPage } from "./budget-page";

export const budgetPlugin: Plugin = {
  name: "budget",
  routes: [{ path: "/budget", element: <BudgetPage /> }],
  navItems: [{ label: "Budget", to: "/budget", order: 40 }],
};
