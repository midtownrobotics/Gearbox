import { SlackChannelPicker } from "@g3/ui";
import { useEffect, useState } from "react";
import { FaTimes } from "react-icons/fa";
import {
  type DmCandidate,
  NOTIFICATION_STYLES,
  NOTIFICATION_TYPES,
  type NotificationSettings,
  type NotificationType,
  type NotificationTypeSettings,
  type PortalAudience,
  platform,
} from "../../lib/platform";

// Where the platform's notifications go for this team (workers/platform/src/notifications.ts):
// for each type, who sees it on the home page, and the Slack channel and members it's sent to.

const AUDIENCES: { value: PortalAudience; label: string }[] = [
  { value: "everyone", label: "Everyone" },
  { value: "admins", label: "Admins" },
  { value: "nobody", label: "Nobody" },
];

const TYPE_HINTS: Record<NotificationType, string> = {
  critical: "Needs a admin's attention right away.",
  warning: "Planned downtime and version changes.",
  info: "Updates, surveys and other news.",
};

type Loaded = { settings: NotificationSettings; members: DmCandidate[] };

export function NotificationsPage() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    platform<Loaded>("/team/notification-settings")
      .then((data) => {
        setLoaded(data);
        setDraft(data.settings);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const dirty = !!loaded && JSON.stringify(loaded.settings) !== JSON.stringify(draft);

  function update(type: NotificationType, change: Partial<NotificationTypeSettings>) {
    setSaved(false);
    setDraft((d) => (d ? { ...d, [type]: { ...d[type], ...change } } : d));
  }

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
    <main className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="mb-2 text-3xl font-bold text-secondary-900">Notifications</h1>
      <p className="mb-6 text-secondary-600">
        Gearbox sends notifications about updates, downtime and anything that needs your attention.
        Choose who sees each kind on your team's home page and where it goes on Slack.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}
      {!draft && !error && <p className="text-secondary-600">Loading…</p>}
      {draft && loaded && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          {NOTIFICATION_TYPES.map(({ type, label }) => (
            <TypeCard
              key={type}
              type={type}
              label={label}
              value={draft[type]}
              members={loaded.members}
              onChange={(change) => update(type, change)}
            />
          ))}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!dirty || busy}
              className="rounded-lg bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => setDraft(loaded.settings)}
                className="px-3 py-2 text-secondary-600 hover:text-secondary-900"
              >
                Undo changes
              </button>
            )}
            {saved && !dirty && <span className="text-sm text-green-700">Saved.</span>}
          </div>
        </form>
      )}
    </main>
  );
}

function TypeCard({
  type,
  label,
  value,
  members,
  onChange,
}: {
  type: NotificationType;
  label: string;
  value: NotificationTypeSettings;
  members: DmCandidate[];
  onChange: (change: Partial<NotificationTypeSettings>) => void;
}) {
  const style = NOTIFICATION_STYLES[type];
  return (
    <section
      className={`space-y-5 rounded-lg border border-l-4 border-line bg-surface p-4 ${style.stripe}`}
    >
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-secondary-900">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>
            {label}
          </span>
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{TYPE_HINTS[type]}</p>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-secondary-800">
          Show on the home page to
        </legend>
        <div className="inline-flex overflow-hidden rounded-lg border border-line">
          {AUDIENCES.map((a, i) => (
            <label
              key={a.value}
              className={`cursor-pointer px-3 py-1.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-300 ${
                i > 0 ? "border-l border-line" : ""
              } ${
                value.portal === a.value
                  ? "bg-primary-600 font-semibold text-white"
                  : "bg-surface text-secondary-700 hover:bg-inset"
              }`}
            >
              <input
                type="radio"
                name={`portal-${type}`}
                value={a.value}
                checked={value.portal === a.value}
                onChange={() => onChange({ portal: a.value })}
                className="sr-only"
              />
              {a.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor={`channel-${type}`}
          className="mb-1 block text-sm font-medium text-secondary-800"
        >
          Slack channel
        </label>
        <SlackChannelPicker
          app="portal"
          id={`channel-${type}`}
          value={value.slackChannel}
          onChange={(slackChannel) => onChange({ slackChannel })}
        />
      </div>

      <PeopleList
        type={type}
        chosen={value.slackUsers}
        members={members}
        onChange={(slackUsers) => onChange({ slackUsers })}
      />
    </section>
  );
}

function PeopleList({
  type,
  chosen,
  members,
  onChange,
}: {
  type: NotificationType;
  chosen: string[];
  members: DmCandidate[];
  onChange: (userIds: string[]) => void;
}) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const available = members.filter((m) => !chosen.includes(m.id));
  const id = `people-${type}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-secondary-800">
        Direct messages on Slack
      </label>
      {chosen.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {chosen.map((userId) => {
            const m = byId.get(userId);
            return (
              <Chip
                key={userId}
                label={m?.displayName ?? "Former member"}
                warning={m && !m.hasSlack ? "hasn't linked Slack" : undefined}
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
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-secondary-900 focus:border-primary-500 focus:outline-none"
      >
        <option value="">Add a person…</option>
        {available.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.hasSlack}>
            {m.displayName}
            {m.isAdmin ? " (admin)" : ""}
            {m.hasSlack ? "" : " (no Slack linked)"}
          </option>
        ))}
      </select>
    </div>
  );
}

function Chip({
  label,
  warning,
  onRemove,
}: {
  label: string;
  warning?: string;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-1 rounded-full border border-line bg-inset py-0.5 pr-1 pl-3 text-sm text-secondary-900">
      {label}
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
