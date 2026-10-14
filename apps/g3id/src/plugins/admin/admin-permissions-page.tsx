import {
  Badge,
  Button,
  Card,
  Chip,
  ConfirmButton,
  ErrorBanner,
  Field,
  Loading,
  Page,
  SuccessBanner,
  Switch,
  inputClass,
  tones,
} from "@g3/ui";
import type { AppPermission, PermissionApp, PermissionMember } from "@g3/worker-g3id";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { permissionRequest } from "./permission-request";
import { SpecificPermissions } from "./specific-permissions";

type State = {
  apps: { slug: PermissionApp; label: string; mentor: boolean }[];
  members: PermissionMember[];
  currentUserId: string;
};

const endpoint = "/api/admin/permissions";

const roleSummaries: Record<PermissionApp, { trustedStudent: string; mentorAccess?: string }> = {
  id: { trustedStudent: "Accounts & roles", mentorAccess: "App tools" },
  portal: { trustedStudent: "Home settings" },
  shop: { trustedStudent: "Shop controls", mentorAccess: "Role only" },
  pit: { trustedStudent: "Pit settings" },
  orders: { trustedStudent: "Orders & catalog", mentorAccess: "Orders & catalog" },
  inventory: { trustedStudent: "Settings & inventory", mentorAccess: "Merge, split, delete" },
  edge: { trustedStudent: "Box & devices" },
  scouting: { trustedStudent: "Scouting controls" },
  "skill-tree": { trustedStudent: "Trees & sign-offs", mentorAccess: "Trees & sign-offs" },
  attendance: { trustedStudent: "Hours & settings" },
};

/** Permission assignments live here; each app keeps its own settings and enforcement. */
export function AdminPermissionsPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await permissionRequest<State>(endpoint);
    setData(result);
  }, []);
  useEffect(() => {
    load()
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [load]);
  const app = data?.apps.find((item) => item.slug === params.get("app")) ?? data?.apps[0];
  const query = params.get("q") ?? "";
  const memberId = params.get("member");
  const members =
    data?.members.filter(
      (member) =>
        (!memberId || member.id === memberId) &&
        `${member.displayName} ${member.email}`.toLowerCase().includes(query.trim().toLowerCase()),
    ) ?? [];
  async function save(member: PermissionMember, permission: AppPermission) {
    if (!app) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await permissionRequest(`${endpoint}/${encodeURIComponent(member.id)}/${app.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trustedStudent: permission.trustedStudent,
          mentorAccess: app.mentor && permission.mentorAccess,
        }),
      });
      await load();
      setSaved("Permissions saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save permissions.");
    } finally {
      setBusy(false);
    }
  }
  async function reset(member: PermissionMember) {
    if (!app) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      await permissionRequest(`${endpoint}/${encodeURIComponent(member.id)}/${app.slug}`, {
        method: "DELETE",
      });
      await load();
      setSaved("ID roles restored for this app.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset permissions.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="Admin" width="wide">
      {error && <ErrorBanner message={error} />}
      {saved && <SuccessBanner message={saved} />}
      {loading && <Loading />}
      {!loading && !data && (
        <Button
          variant="secondary"
          onClick={() => {
            setLoading(true);
            setError("");
            load()
              .catch((cause) => setError(cause.message))
              .finally(() => setLoading(false));
          }}
        >
          Retry
        </Button>
      )}
      {data && app && (
        <>
          <nav aria-label="App permissions" className="flex flex-wrap gap-2">
            {data.apps.map((item) => (
              <Chip
                key={item.slug}
                selected={item.slug === app.slug}
                disabled={busy}
                className="text-xs"
                onClick={() => {
                  setSaved("");
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("app", item.slug);
                    return next;
                  });
                }}
              >
                {item.label}
              </Chip>
            ))}
          </nav>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Find a member">
              <input
                type="search"
                className={inputClass}
                value={query}
                onChange={(event) =>
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current);
                      next.set("q", event.target.value);
                      next.delete("member");
                      return next;
                    },
                    { replace: true },
                  )
                }
                placeholder="Name or email"
              />
            </Field>
            {memberId && (
              <Button
                variant="secondary"
                onClick={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.delete("member");
                    return next;
                  })
                }
              >
                Show all members
              </Button>
            )}
          </div>
          <Card title={`${app.label} permissions`} className="space-y-4">
            <div className="divide-y divide-line">
              {members.map((member) => {
                const permission = member.permissions[app.slug];
                return (
                  <div
                    key={`${app.slug}:${member.id}`}
                    className="flex min-w-0 flex-wrap items-center justify-between gap-4 py-4"
                  >
                    <div className="min-w-0 flex-1 basis-52">
                      <p className="break-words text-sm font-medium text-secondary-900">
                        {member.displayName}
                      </p>
                      <p className="break-all text-xs text-secondary-500">{member.email}</p>
                      {permission.inherited && <Badge colors={tones.neutral}>ID roles</Badge>}
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2 text-xs text-secondary-900">
                        <Switch
                          checked={permission.trustedStudent}
                          label={`Trusted student: ${member.displayName}`}
                          aria-describedby={`trusted-summary-${app.slug}-${member.id}`}
                          disabled={busy || (app.slug === "id" && member.id === data.currentUserId)}
                          onChange={(checked) =>
                            save(member, { ...permission, trustedStudent: checked })
                          }
                        />
                        <span className="leading-3">
                          <span className="block">Trusted student</span>
                          <span
                            id={`trusted-summary-${app.slug}-${member.id}`}
                            className="block whitespace-nowrap text-[10px] text-secondary-500"
                          >
                            {roleSummaries[app.slug].trustedStudent}
                          </span>
                        </span>
                      </div>
                      {app.mentor && (
                        <div className="flex items-center gap-2 text-xs text-secondary-900">
                          <Switch
                            checked={permission.mentorAccess}
                            label={`Mentor${app.slug === "id" ? "" : " access"}: ${member.displayName}`}
                            aria-describedby={`mentor-summary-${app.slug}-${member.id}`}
                            disabled={busy}
                            onChange={(checked) =>
                              save(member, { ...permission, mentorAccess: checked })
                            }
                          />
                          <span className="leading-3">
                            <span className="block">
                              {app.slug === "id" ? "Mentor" : "Mentor access"}
                            </span>
                            <span
                              id={`mentor-summary-${app.slug}-${member.id}`}
                              className="block whitespace-nowrap text-[10px] text-secondary-500"
                            >
                              {roleSummaries[app.slug].mentorAccess}
                            </span>
                          </span>
                        </div>
                      )}
                      {app.slug !== "id" && !permission.inherited && (
                        <ConfirmButton
                          label="Use ID roles"
                          size="sm"
                          disabled={busy}
                          question={`Use ${member.displayName}'s ID roles for ${app.label}?`}
                          confirmLabel="Use ID roles"
                          onConfirm={() => reset(member)}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {!members.length && (
              <p className="text-xs text-secondary-500">No active members match.</p>
            )}
          </Card>
          {(app.slug === "orders" || app.slug === "scouting") && (
            <SpecificPermissions key={app.slug} app={app.slug} members={members} />
          )}
        </>
      )}
    </Page>
  );
}
