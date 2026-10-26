import {
  Button,
  Card,
  ChannelPicker,
  ErrorBanner,
  Page,
  PageLoading,
  SuccessBanner,
  chatName,
  inputClass,
  useTeamChat,
} from "@g3/ui";
import { useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";
import { Link, useSearchParams } from "react-router-dom";
import {
  type DmCandidate,
  NOTIFICATION_STYLES,
  NOTIFICATION_TYPES,
  type NotificationSettings,
  type NotificationSource,
  type NotificationType,
  type NotificationTypeSettings,
  type PortalAudience,
  platform,
} from "../../lib/platform";
import { TeamNotifications } from "./team-notifications";

// The team's notifications (workers/platform/src/notifications.ts): sending one to the team
// (team-notifications.tsx), and where each kind goes, set apart for Gearbox's and the team's own:
// who sees it on the home page and a channel on the team's chat (Slack or Discord). Only
// Gearbox's Critical ones are also DMed.

const AUDIENCES: { value: PortalAudience; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "admins", label: "Admins only" },
  { value: "nobody", label: "Nobody" },
];

const SOURCES: { source: NotificationSource; title: string; hint: string }[] = [
  {
    source: "gearbox",
    title: "From Gearbox",
    hint: "From the people who run Gearbox itself, for every team.",
  },
  { source: "team", title: "From your team", hint: "What your admins send above." },
];

type Loaded = { settings: NotificationSettings; members: DmCandidate[] };

export function NotificationsPage() {
  const chat = chatName(useTeamChat());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // A new team's founder lands here from sign-up (?welcome=1): notifications first, then apps.
  const [params] = useSearchParams();
  const welcome = params.get("welcome") === "1";

  useEffect(() => {
    platform<Loaded>("/team/notification-settings")
      .then((data) => {
        setLoaded(data);
        setDraft(data.settings);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const dirty = !!loaded && JSON.stringify(loaded.settings) !== JSON.stringify(draft);

  function update(
    source: NotificationSource,
    type: NotificationType,
    change: Partial<NotificationTypeSettings>,
  ) {
    setSaved(false);
    setDraft((d) =>
      d ? { ...d, [source]: { ...d[source], [type]: { ...d[source][type], ...change } } } : d,
    );
  }

  /** Every kind's channel, Gearbox's and the team's, at once. */
  function setAllChannels(channel: string | null) {
    setSaved(false);
    setDraft((d) =>
      d
        ? (Object.fromEntries(
            SOURCES.map(({ source }) => [
              source,
              Object.fromEntries(
                NOTIFICATION_TYPES.map(({ type }) => [type, { ...d[source][type], channel }]),
              ),
            ]),
          ) as NotificationSettings)
        : d,
    );
  }

  /** The channel every kind has, when they all have the same one. */
  const channels = draft
    ? SOURCES.flatMap(({ source }) =>
        NOTIFICATION_TYPES.map(({ type }) => draft[source][type]),
      ).map((s) => s.channel)
    : [];
  const sharedChannel = channels.every((c) => c === channels[0]) ? (channels[0] ?? null) : null;

  async function save() {
    if (!draft || !loaded) return;
    setBusy(true);
    setError("");
    try {
      const { settings } = await platform<{ settings: NotificationSettings }>(
        "/team/notification-settings",
        { method: "PUT", body: draft },
      );
      setLoaded({ ...loaded, settings });
      setDraft(settings);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Notifications"
      description={`Send your team news, and choose where it and Gearbox's updates go: the home page and ${chat}.`}
    >
      {welcome && (
        <p className="rounded-lg border border-line bg-surface p-4 text-secondary-700">
          <strong className="text-secondary-900">Welcome to Gearbox!</strong> Start by choosing
          where notifications go below, then{" "}
          <Link to="/admin" className="font-semibold text-primary-600 hover:underline">
            choose your team's apps
          </Link>
          .
        </p>
      )}
      {error && <ErrorBanner message={error} />}
      {!draft && !error && <PageLoading />}
      {loaded && <TeamNotifications settings={loaded.settings} />}
      {draft && loaded && (
        <Card title="Where notifications go">
          <form
            className="space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="min-w-0 rounded-lg bg-inset p-3">
              <label htmlFor="all-channels" className="mb-1 block text-sm text-secondary-700">
                Set every channel to
              </label>
              <ChannelPicker id="all-channels" value={sharedChannel} onChange={setAllChannels} />
            </div>
            {SOURCES.map(({ source, title, hint }) => (
              <fieldset key={source} className="space-y-3">
                <legend className="font-semibold text-secondary-900">{title}</legend>
                <p className="text-sm text-secondary-600">{hint}</p>
                {NOTIFICATION_TYPES.map(({ type, label }) => (
                  <TypeRow
                    key={type}
                    id={`${source}-${type}`}
                    label={label}
                    type={type}
                    value={draft[source][type]}
                    members={source === "gearbox" && type === "critical" ? loaded.members : null}
                    onChange={(change) => update(source, type, change)}
                  />
                ))}
              </fieldset>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!dirty || busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
              {dirty && (
                <Button variant="secondary" onClick={() => setDraft(loaded.settings)}>
                  Undo changes
                </Button>
              )}
            </div>
            {saved && !dirty && <SuccessBanner message="Saved." />}
          </form>
        </Card>
      )}
    </Page>
  );
}

/**
 * One kind's settings on a line: who sees it on the home page and its channel, with the people
 * DMed under them when `members` is given (Gearbox's Critical only).
 */
function TypeRow({
  id,
  label,
  type,
  value,
  members,
  onChange,
}: {
  id: string;
  label: string;
  type: NotificationType;
  value: NotificationTypeSettings;
  members: DmCandidate[] | null;
  onChange: (change: Partial<NotificationTypeSettings>) => void;
}) {
  const style = NOTIFICATION_STYLES[type];
  const chat = chatName(useTeamChat());
  return (
    <div className={`space-y-3 rounded-lg border border-l-4 border-line p-3 ${style.stripe}`}>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>{label}</span>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={`${id}-portal`} className="mb-1 block text-sm text-secondary-700">
            Home page
          </label>
          <select
            id={`${id}-portal`}
            value={value.portal}
            onChange={(e) => onChange({ portal: e.target.value as PortalAudience })}
            className={inputClass}
          >
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-channel`} className="mb-1 block text-sm text-secondary-700">
            {chat} channel
          </label>
          <ChannelPicker
            id={`${id}-channel`}
            value={value.channel}
            onChange={(channel) => onChange({ channel })}
          />
        </div>
      </div>
      {members && (
        <PeopleList
          id={`${id}-people`}
          chosen={value.users}
          members={members}
          onChange={(users) => onChange({ users })}
        />
      )}
    </div>
  );
}

function PeopleList({
  id,
  chosen,
  members,
  onChange,
}: {
  id: string;
  chosen: string[];
  members: DmCandidate[];
  onChange: (userIds: string[]) => void;
}) {
  const chat = chatName(useTeamChat());
  const byId = new Map(members.map((m) => [m.id, m]));
  const available = members.filter((m) => !chosen.includes(m.id));
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-secondary-700">
        Also message directly on {chat}
      </label>
      {chosen.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {chosen.map((userId) => {
            const m = byId.get(userId);
            return (
              <Person
                key={userId}
                label={m?.displayName ?? "Former member"}
                warning={m && !m.hasChat ? `hasn't linked ${chat}` : undefined}
                onRemove={() => onChange(chosen.filter((x) => x !== userId))}
              />
            );
          })}
        </ul>
      )}
      <select
        id={id}
        value=""
        onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}
        className={`${inputClass} max-w-full sm:w-auto`}
      >
        <option value="">Add a person…</option>
        {available.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.hasChat}>
            {m.displayName}
            {m.isAdmin ? " (admin)" : ""}
            {m.hasChat ? "" : ` (no ${chat} linked)`}
          </option>
        ))}
      </select>
    </div>
  );
}

function Person({
  label,
  warning,
  onRemove,
}: {
  label: string;
  warning?: string;
  onRemove: () => void;
}) {
  return (
    <li className="flex min-w-0 items-center gap-1 rounded-full border border-line bg-inset py-0.5 pr-1 pl-3 text-sm text-secondary-900">
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      {warning && <span className="text-xs text-amber-700">({warning})</span>}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="rounded-full p-1 text-secondary-500 hover:bg-secondary-200 hover:text-secondary-900"
      >
        <FaTimes size={10} aria-hidden />
      </button>
    </li>
  );
}
