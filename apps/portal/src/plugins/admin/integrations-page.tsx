import { type AppName, apiPath, appUrl } from "@g3/site-config";
import {
  Badge,
  Card,
  ConfirmButton,
  ErrorBanner,
  Loading,
  Page,
  SuccessBanner,
  buttonClass,
  tones,
} from "@g3/ui";
import { type ReactNode, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { g3id } from "../../lib/api";
import {
  type IntegrationStatus,
  type LibraryApp,
  appIntegrations,
  platform,
} from "../../lib/platform";

// The services outside Gearbox the team's apps work with: whether each is connected, what's known
// about the connection, what the team uses it for, and where it's set up. Slack is connected here
// (G3ID's /admin/slack and /slack/install, through /api/~id; Slack sends the admin back here).
// The others' status comes from the app that connects them (its /team-settings), and they're set
// up in that app.

type Status = IntegrationStatus | "loading" | "unknown";

type SlackStatus = {
  connected: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  /** Connected through the server's settings (from before teams), not this page. */
  fromSettings: boolean;
  canConnect: boolean;
};

/** What the team uses an integration for, by the app that uses it ("id" and null: always). */
type Use = { app: AppName | null; text: string };

type Integration = {
  key: string;
  name: string;
  summary: string;
  uses: Use[];
  /** The app that connects it, or null when there's nothing to connect. */
  owner: AppName | null;
  /** Where it's set up: a path in the owner app. */
  page?: string;
};

const SLACK_USES: Use[] = [
  { app: null, text: "Signing in: members get their sign-in code from the bot." },
  { app: null, text: "Admins hear when an app is switched on or off." },
  { app: null, text: "Gearbox notifications go to the channel and people set on Notifications." },
  { app: "orders", text: "Orders tells people when their request is approved." },
  {
    app: "shop",
    text: "Shop posts releases and daily summaries to the channels set on its Admin page.",
  },
];

const INTEGRATIONS: Integration[] = [
  {
    key: "edge box",
    name: "Edge box",
    summary: "Your shop's own network box.",
    uses: [
      { app: "edge", text: "Edge shows the shop network's data use and runs its blocking." },
      { app: "orders", text: "Orders looks up part details from a vendor link." },
      { app: "shop", text: "Shop prints to the shop's printers." },
    ],
    owner: "edge",
    page: "/box",
  },
  {
    key: "onshape",
    name: "Onshape",
    summary: "Your team's CAD document.",
    uses: [{ app: "shop", text: "Shop follows the document's releases and their parts." }],
    owner: "shop",
    page: "/admin",
  },
  {
    key: "share-a-cart",
    name: "Share-A-Cart",
    summary: "Shared Amazon carts.",
    uses: [{ app: "orders", text: "Orders fills an Amazon cart in one click on the Carts page." }],
    owner: "orders",
    page: "/admin",
  },
  {
    key: "the blue alliance",
    name: "The Blue Alliance",
    summary: "FRC event data. Built in, so there's nothing to connect.",
    uses: [
      { app: "pit", text: "Pit shows the event's match schedule and rankings." },
      { app: "scouting", text: "Scouting loads events, matches and teams." },
    ],
    owner: null,
  },
];

const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Connected or not, on one line beside the name. */
function StatusBadge({ status }: { status: Status }) {
  const fixed = "shrink-0 whitespace-nowrap text-xs";
  if (status === "loading") return <span className={`${fixed} text-secondary-500`}>Checking…</span>;
  if (status === "unknown") return <span className={`${fixed} text-secondary-500`}>Unknown</span>;
  return (
    <Badge colors={status.connected ? tones.success : tones.neutral}>
      {status.connected ? "Connected" : "Not connected"}
    </Badge>
  );
}

function IntegrationCard({
  name,
  summary,
  status,
  uses,
  children,
}: {
  name: string;
  summary: string;
  status?: Status;
  uses: string[];
  children?: ReactNode;
}) {
  const known = status && typeof status !== "string" ? status : null;
  return (
    <li>
      <Card>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-secondary-900">{name}</h2>
            <p className="text-sm text-secondary-600">{summary}</p>
          </div>
          {status && <StatusBadge status={status} />}
        </div>
        {known?.detail && <p className="mt-2 text-sm text-amber-700">{known.detail}</p>}
        {known?.facts && known.facts.length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md bg-inset px-3 py-2 text-sm">
            {known.facts.map((fact) => (
              <div key={fact.label} className="contents">
                <dt className="text-secondary-500">{fact.label}</dt>
                <dd className="min-w-0 break-words text-secondary-900">
                  {[fact.at ? when(fact.at) : null, fact.value].filter(Boolean).join(", ")}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {uses.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
              Used for
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-secondary-700">
              {uses.map((use) => (
                <li key={use}>{use}</li>
              ))}
            </ul>
          </div>
        )}
        {children && <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>}
      </Card>
    </li>
  );
}

const linkButton = buttonClass("primary", "sm");

export function IntegrationsPage() {
  const [searchParams] = useSearchParams();
  const [apps, setApps] = useState<LibraryApp[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [slack, setSlack] = useState<SlackStatus | "loading" | "unknown">("loading");
  const [error, setError] = useState(searchParams.get("error") ?? "");
  const [busy, setBusy] = useState(false);

  async function loadSlack() {
    try {
      const res = await g3id.admin.slack.$get();
      if (!res.ok) throw new Error();
      setSlack((await res.json()) as SlackStatus);
    } catch {
      setSlack("unknown");
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once
  useEffect(() => {
    loadSlack();
    platform<LibraryApp[]>("/team/library")
      .then((library) => {
        setApps(library);
        const on = new Set(library.filter((a) => a.enabled).map((a) => a.slug));
        for (const i of INTEGRATIONS) {
          if (!i.owner || !on.has(i.owner)) continue;
          setStatuses((s) => ({ ...s, [i.key]: "loading" }));
          appIntegrations(i.owner)
            .then((state) => setStatuses((s) => ({ ...s, [i.key]: state[i.key] ?? "unknown" })))
            .catch(() => setStatuses((s) => ({ ...s, [i.key]: "unknown" })));
        }
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function disconnectSlack() {
    setBusy(true);
    setError("");
    try {
      const res = await g3id.admin.slack.$delete();
      if (!res.ok) throw new Error();
      await loadSlack();
    } catch {
      setError("Couldn't disconnect Slack.");
    } finally {
      setBusy(false);
    }
  }

  const on = new Set(apps?.filter((a) => a.enabled).map((a) => a.slug) ?? []);
  const usesOf = (uses: Use[]) =>
    uses.filter((u) => u.app === null || on.has(u.app)).map((u) => u.text);
  const shown = INTEGRATIONS.filter((i) => usesOf(i.uses).length > 0);
  const ownerName = (slug: AppName) => apps?.find((a) => a.slug === slug)?.name ?? slug;

  const slackStatus: Status =
    typeof slack === "string"
      ? slack
      : {
          connected: slack.connected,
          detail: slack.fromSettings
            ? "Connected through the server's settings. Reconnect to manage it from here."
            : undefined,
          facts: slack.connected
            ? [
                { label: "Workspace", value: slack.workspaceName ?? "Unnamed" },
                ...(slack.workspaceId ? [{ label: "Workspace ID", value: slack.workspaceId }] : []),
              ]
            : undefined,
        };

  return (
    <Page
      title="Integrations"
      description="The services your team's apps work with, what each is used for, and where to set it up."
      width="narrow"
    >
      {error && <ErrorBanner message={error} />}
      {searchParams.get("connected") && typeof slack !== "string" && slack.connected && (
        <SuccessBanner message="Slack is connected." />
      )}
      <ul className="space-y-3">
        <IntegrationCard
          name="Slack"
          summary="Your team's Slack workspace."
          status={slackStatus}
          uses={usesOf(SLACK_USES)}
        >
          {typeof slack !== "string" && slack.canConnect && (
            <>
              <a href={`${apiPath("id")}/slack/install`} className={linkButton}>
                {slack.connected ? "Reconnect" : "Connect Slack"}
              </a>
              {slack.connected && !slack.fromSettings && (
                <ConfirmButton
                  size="sm"
                  label="Disconnect"
                  question="Disconnect Slack? Members can't sign in with Slack, and the apps can't message anyone, until it's connected again."
                  disabled={busy}
                  onConfirm={() => void disconnectSlack()}
                />
              )}
            </>
          )}
          {typeof slack !== "string" && !slack.canConnect && (
            <p className="text-sm text-secondary-500">
              Connecting a workspace isn't set up on this server yet.
            </p>
          )}
        </IntegrationCard>

        {apps === null && !error && (
          <li>
            <Loading />
          </li>
        )}
        {shown.map((i) => {
          const ownerOn = i.owner !== null && on.has(i.owner);
          return (
            <IntegrationCard
              key={i.key}
              name={i.name}
              summary={i.summary}
              status={ownerOn ? (statuses[i.key] ?? "loading") : undefined}
              uses={usesOf(i.uses)}
            >
              {i.owner && ownerOn && i.page && (
                <a href={`${appUrl(i.owner)}${i.page}`} className={linkButton}>
                  Set up in {ownerName(i.owner)}
                </a>
              )}
              {i.owner && !ownerOn && (
                <p className="text-sm text-secondary-600">
                  Switch on {ownerName(i.owner)} on the{" "}
                  <Link to="/admin" className="font-semibold text-primary-700 underline">
                    Manage Apps
                  </Link>{" "}
                  page to connect one.
                </p>
              )}
            </IntegrationCard>
          );
        })}
      </ul>
    </Page>
  );
}
