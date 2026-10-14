import { apiPath } from "@g3/site-config";
import {
  Button,
  Card,
  ErrorBanner,
  Field,
  Loading,
  SuccessBanner,
  Switch,
  inputClass,
} from "@g3/ui";
import type { PermissionMember } from "@g3/worker-g3id";
import { useCallback, useEffect, useState } from "react";
import { permissionRequest } from "./permission-request";

type ScoutPermissions = {
  leads: { userId: string }[];
  publishers: { email: string }[];
  helpers: { userId: string; skills: string }[];
};
type Extra = ScoutPermissions & { catalog: { id: string; trusted: boolean }[] };
type Permission = "strategy" | "publish" | "helper" | "catalog";

export function SpecificPermissions({
  app,
  members,
}: { app: "orders" | "scouting"; members: PermissionMember[] }) {
  const [data, setData] = useState<Extra | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (app === "orders") {
      const catalog = await permissionRequest<Extra["catalog"]>(`${apiPath("orders")}/trusted`);
      setData({ catalog, leads: [], publishers: [], helpers: [] });
    } else {
      const result = await permissionRequest<ScoutPermissions>(
        `${apiPath("scouting")}/scouting/permission-management`,
      );
      setData({ ...result, catalog: [] });
      setSkills(
        Object.fromEntries(
          result.helpers.map((helper) => {
            let values: string[] = [];
            try {
              const parsed: unknown = JSON.parse(helper.skills);
              values = Array.isArray(parsed)
                ? parsed.filter((value): value is string => typeof value === "string")
                : [];
            } catch {
              /* Empty legacy skills. */
            }
            return [helper.userId, values.join(", ")];
          }),
        ),
      );
    }
  }, [app]);
  useEffect(() => {
    load().catch((cause) => setError(cause.message));
  }, [load]);
  async function change(member: PermissionMember, permission: Permission, enabled: boolean) {
    setBusy(true);
    setError("");
    setSaved("");
    try {
      let url: string;
      let method = enabled ? "POST" : "DELETE";
      let body: unknown;
      if (permission === "catalog") {
        url = `${apiPath("orders")}/trusted/${encodeURIComponent(member.id)}`;
        method = "PUT";
        body = { trusted: enabled };
      } else {
        const route =
          permission === "strategy"
            ? "strategy-admins"
            : permission === "publish"
              ? "field-map-publishers"
              : "service-helpers";
        url = `${apiPath("scouting")}/scouting/${route}${enabled ? "" : `/${encodeURIComponent(permission === "publish" ? member.email : member.id)}`}`;
        if (enabled)
          body = {
            userId: member.id,
            ...(permission === "helper"
              ? {
                  skills: (skills[member.id] ?? "")
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                }
              : {}),
          };
      }
      await permissionRequest(url, {
        method,
        ...(body
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      await load();
      setSaved("Permission saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save permission.");
    } finally {
      setBusy(false);
    }
  }
  const choices: [Permission, string][] =
    app === "orders"
      ? [["catalog", "Edit catalog"]]
      : [
          ["strategy", "Manage forms and strategy"],
          ["publish", "Publish field maps"],
          ["helper", "Service crew"],
        ];
  return (
    <Card
      title={app === "orders" ? "Catalog editors" : "Additional permissions"}
      className="space-y-4"
    >
      {error && <ErrorBanner message={error} />}
      {saved && <SuccessBanner message={saved} />}
      {!data && !error && <Loading />}
      {error && !data && (
        <Button
          variant="secondary"
          onClick={() => {
            setError("");
            load().catch((cause) => setError(cause.message));
          }}
        >
          Retry
        </Button>
      )}
      {data && (
        <div className="divide-y divide-line">
          {members.map((member) => (
            <div key={member.id} className="space-y-3 py-4">
              <p className="break-words text-sm font-medium text-secondary-900">
                {member.displayName}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                {choices.map(([permission, label]) => {
                  const checked =
                    permission === "catalog"
                      ? data.catalog.some((item) => item.id === member.id && item.trusted)
                      : permission === "strategy"
                        ? data.leads.some((item) => item.userId === member.id)
                        : permission === "publish"
                          ? data.publishers.some(
                              (item) => item.email.toLowerCase() === member.email.toLowerCase(),
                            )
                          : data.helpers.some((item) => item.userId === member.id);
                  return (
                    <div
                      key={permission}
                      className="flex items-center gap-2 text-xs text-secondary-900"
                    >
                      <Switch
                        checked={checked}
                        label={`${label}: ${member.displayName}`}
                        disabled={busy}
                        onChange={(enabled) => change(member, permission, enabled)}
                      />
                      {label}
                    </div>
                  );
                })}
              </div>
              {data.helpers.some((item) => item.userId === member.id) && (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Service skills">
                    <input
                      className={inputClass}
                      value={skills[member.id] ?? ""}
                      placeholder="Mechanical, electrical, programming"
                      onChange={(event) =>
                        setSkills((current) => ({ ...current, [member.id]: event.target.value }))
                      }
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => change(member, "helper", true)}
                  >
                    Save skills
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {data && !members.length && (
        <p className="text-xs text-secondary-500">No active members match.</p>
      )}
    </Card>
  );
}
