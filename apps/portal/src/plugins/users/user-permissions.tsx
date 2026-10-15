import { apiPath } from "@g3/site-config";
import { Card, Chip, ErrorBanner, Loading, SuccessBanner, Switch } from "@g3/ui";
import type { PermissionCatalogApp, PermissionMember } from "@g3/worker-g3id";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { permissionRequest } from "./permission-request";

type State = { apps: PermissionCatalogApp[]; members: PermissionMember[]; currentUserId: string };
const endpoint = `${apiPath("id")}/admin/permissions`;
export function UserPermissions({
  userId,
  onRolesChanged,
}: { userId: string; onRolesChanged: (roles: { isAdmin: number; isMentor: number }) => void }) {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setData(await permissionRequest<State>(endpoint)), []);
  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [load]);
  const member = data?.members.find((person) => person.id === userId);
  const app = data?.apps.find((item) => item.slug === params.get("app")) ?? data?.apps[0];
  async function save(url: string, body: unknown, roles?: { isAdmin: boolean; isMentor: boolean }) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await permissionRequest(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
      if (roles)
        onRolesChanged({ isAdmin: Number(roles.isAdmin), isMentor: Number(roles.isMentor) });
      setSaved("Permissions saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save permissions.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <ErrorBanner message={error} />}
      {saved && <SuccessBanner message={saved} />}
      {!data && !error && <Loading />}
      {member && data && (
        <>
          <Card title="Site-wide roles">
            <div className="flex flex-wrap gap-6">
              {(
                [
                  ["isAdmin", "Admin", "Every permission in every app."],
                  ["isMentor", "Mentor", "Mentor tools across all apps."],
                ] as const
              ).map(([key, label, description]) => (
                <div key={key} className="flex items-center gap-2">
                  <Switch
                    checked={member[key]}
                    disabled={busy || (key === "isAdmin" && member.id === data.currentUserId)}
                    label={`${label}: ${member.displayName}`}
                    aria-describedby={`role-${key}-${userId}`}
                    onChange={(checked) => {
                      const roles = {
                        isAdmin: member.isAdmin,
                        isMentor: member.isMentor,
                        [key]: checked,
                      };
                      save(`${endpoint}/${encodeURIComponent(userId)}/roles`, roles, roles);
                    }}
                  />
                  <div>
                    <p className="text-xs text-secondary-900">{label}</p>
                    <p id={`role-${key}-${userId}`} className="text-[10px] text-secondary-500">
                      {description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          {app && (
            <>
              <nav aria-label="Student app permissions" className="flex flex-wrap gap-2">
                {data.apps.map((item) => (
                  <Chip
                    key={item.slug}
                    selected={item.slug === app.slug}
                    disabled={busy}
                    className="text-xs"
                    onClick={() =>
                      setParams(
                        (current) => {
                          const next = new URLSearchParams(current);
                          next.set("app", item.slug);
                          return next;
                        },
                        { replace: true },
                      )
                    }
                  >
                    {item.name}
                  </Chip>
                ))}
              </nav>
              <Card title={`${app.name} permissions`}>
                <div className="divide-y divide-line">
                  {app.permissions.map((permission) => {
                    const assigned = member.permissions[app.slug] ?? [];
                    const included = app.permissions.some(
                      (other) =>
                        assigned.includes(other.key) && other.includes?.includes(permission.key),
                    );
                    const role =
                      member.isAdmin || (member.isMentor && permission.roles.includes("mentor"));
                    return (
                      <div key={permission.key} className="flex items-center gap-3 py-3">
                        <Switch
                          checked={role || included || assigned.includes(permission.key)}
                          disabled={busy || role || included}
                          label={`${permission.label}: ${member.displayName}`}
                          aria-describedby={`permission-${app.slug}-${permission.key}-${userId}`}
                          onChange={(enabled) =>
                            save(
                              `${endpoint}/${encodeURIComponent(userId)}/${app.slug}/${encodeURIComponent(permission.key)}`,
                              { enabled },
                            )
                          }
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-secondary-900">
                            {permission.label}
                          </p>
                          <p
                            id={`permission-${app.slug}-${permission.key}-${userId}`}
                            className="text-[10px] text-secondary-500"
                          >
                            {permission.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
