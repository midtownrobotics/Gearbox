import { type AppName, appUrl } from "@g3/site-config";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { g3id } from "../../lib/api";
import { type LibraryApp, appSettings, platform } from "../../lib/platform";

// The services outside Gearbox the team's apps work with, whether each is connected, and where
// it's set up. Each one's status comes from the app that connects it (its /team-settings); Slack's
// from G3ID.

type Status = { connected: boolean; detail?: string } | "loading" | "unknown";

type Integration = {
  key: string;
  name: string;
  summary: string;
  /** The app that connects it, or null when there's nothing to connect. */
  owner: AppName | null;
  /** Where it's set up: a path in the owner app. */
  page?: string;
};

const INTEGRATIONS: Integration[] = [
  {
    key: "edge box",
    name: "Edge box",
    summary: "Your shop's network box. Orders looks up parts through it, and Shop prints with it.",
    owner: "edge",
    page: "/box",
  },
  {
    key: "onshape",
    name: "Onshape",
    summary: "Shop follows your CAD document's releases.",
    owner: "shop",
    page: "/admin",
  },
  {
    key: "share-a-cart",
    name: "Share-A-Cart",
    summary: "One-click Amazon carts in Orders.",
    owner: "orders",
    page: "/settings",
  },
  {
    key: "the blue alliance",
    name: "The Blue Alliance",
    summary: "Event schedules and rankings. Built in, so there's nothing to connect.",
    owner: null,
  },
];

/** Connected or not, on one line beside the name; anything more goes under the summary. */
function StatusBadge({ status }: { status: Status }) {
  const fixed = "shrink-0 whitespace-nowrap text-xs";
  if (status === "loading") return <span className={`${fixed} text-secondary-500`}>Checking…</span>;
  if (status === "unknown") return <span className={`${fixed} text-secondary-500`}>Unknown</span>;
  return (
    <span
      className={`${fixed} rounded-full px-2 py-0.5 font-semibold ${
        status.connected ? "bg-green-100 text-green-800" : "bg-secondary-100 text-secondary-700"
      }`}
    >
      {status.connected ? "Connected" : "Not connected"}
    </span>
  );
}

function StatusDetail({ status }: { status: Status | undefined }) {
  if (!status || typeof status === "string" || !status.detail) return null;
  return <p className="mt-1 text-xs text-secondary-500">{status.detail}</p>;
}

export function IntegrationsPage() {
  const [apps, setApps] = useState<LibraryApp[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [slack, setSlack] = useState<Status>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    g3id.admin.slack
      .$get()
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { connected: boolean; workspaceName: string | null };
        setSlack({
          connected: data.connected,
          detail: data.workspaceName ? `Workspace: ${data.workspaceName}` : undefined,
        });
      })
      .catch(() => setSlack("unknown"));

    platform<LibraryApp[]>("/team/library")
      .then((library) => {
        setApps(library);
        const on = new Set(library.filter((a) => a.enabled).map((a) => a.slug));
        for (const i of INTEGRATIONS) {
          if (!i.owner || !on.has(i.owner)) continue;
          setStatuses((s) => ({ ...s, [i.key]: "loading" }));
          appSettings(i.owner)
            .then((state) =>
              setStatuses((s) => ({ ...s, [i.key]: state.integrations[i.key] ?? "unknown" })),
            )
            .catch(() => setStatuses((s) => ({ ...s, [i.key]: "unknown" })));
        }
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const on = apps?.filter((a) => a.enabled) ?? [];
  const usedBy = (key: string) => on.filter((a) => a.integrations.includes(key)).map((a) => a.name);
  const shown = INTEGRATIONS.filter((i) => usedBy(i.key).length > 0);
  const ownerName = (slug: AppName) => apps?.find((a) => a.slug === slug)?.name ?? slug;

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold text-secondary-900">Integrations</h1>
      <p className="mb-6 text-secondary-600">
        The services your team's apps work with, and where to set each one up.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        <li className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-secondary-900">Slack</h2>
              <p className="text-sm text-secondary-600">
                Members sign in through it, and the apps message them there.
              </p>
              <StatusDetail status={slack} />
            </div>
            <StatusBadge status={slack} />
          </div>
          <Link
            to="/admin/slack"
            className="mt-2 inline-block text-sm font-semibold text-primary-700 underline"
          >
            Set up
          </Link>
        </li>
        {apps === null && !error && <li className="text-secondary-600">Loading…</li>}
        {shown.map((i) => {
          const ownerOn = i.owner !== null && on.some((a) => a.slug === i.owner);
          return (
            <li key={i.key} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-secondary-900">{i.name}</h2>
                  <p className="text-sm text-secondary-600">{i.summary}</p>
                  {ownerOn && <StatusDetail status={statuses[i.key]} />}
                  <p className="mt-1 text-xs text-secondary-500">
                    Used by {usedBy(i.key).join(", ")}
                  </p>
                </div>
                {ownerOn && <StatusBadge status={statuses[i.key] ?? "loading"} />}
              </div>
              {i.owner && ownerOn && i.page && (
                <a
                  href={`${appUrl(i.owner)}${i.page}`}
                  className="mt-2 inline-block text-sm font-semibold text-primary-700 underline"
                >
                  Set up in {ownerName(i.owner)}
                </a>
              )}
              {i.owner && !ownerOn && (
                <p className="mt-2 text-sm text-secondary-600">
                  Switch on {ownerName(i.owner)} on the{" "}
                  <Link to="/admin" className="font-semibold text-primary-700 underline">
                    Apps
                  </Link>{" "}
                  page to connect one.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
