import { type AppName, site } from "@g3/site-config";
import type { AppPermissionDefinition } from "./manifest";

export type PermissionApp = AppName;
export const isPermissionApp = (value: unknown): value is PermissionApp =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(site.apps, value);
export type PermissionCatalogApp = {
  slug: PermissionApp;
  name: string;
  permissions: AppPermissionDefinition[];
};
export type PermissionGrant = { userId: string; app: PermissionApp; permission: string };

export type PermissionMember = {
  id: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
  isMentor: boolean;
  permissions: Partial<Record<PermissionApp, string[]>>;
};
