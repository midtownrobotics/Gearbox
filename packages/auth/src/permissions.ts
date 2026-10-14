/** Apps whose staff permissions are assigned from ID. Slugs stay stable in saved grants. */
export const permissionApps = [
  { slug: "id", label: "ID", mentor: true },
  { slug: "portal", label: "Gearbox Home", mentor: false },
  { slug: "shop", label: "Shop", mentor: true },
  { slug: "pit", label: "Pit", mentor: false },
  { slug: "orders", label: "Orders", mentor: true },
  { slug: "inventory", label: "Inventory", mentor: true },
  { slug: "edge", label: "Edge", mentor: false },
  { slug: "scouting", label: "Scouting", mentor: false },
  { slug: "skill-tree", label: "Skill Tree", mentor: true },
  { slug: "attendance", label: "Attendance", mentor: false },
] as const;

export type PermissionApp = (typeof permissionApps)[number]["slug"];
export const isPermissionApp = (value: unknown): value is PermissionApp =>
  permissionApps.some((app) => app.slug === value);

export type AppPermission = {
  trustedStudent: boolean;
  mentorAccess: boolean;
  inherited: boolean;
};

export type PermissionMember = {
  id: string;
  displayName: string;
  email: string;
  permissions: Record<PermissionApp, AppPermission>;
};
