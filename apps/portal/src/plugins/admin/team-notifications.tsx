import {
  Button,
  Card,
  Chip,
  ConfirmButton,
  ErrorBanner,
  Field,
  SuccessBanner,
  TextField,
  chatName,
  useTeamChat,
} from "@g3/ui";
import { useEffect, useState } from "react";
import {
  NOTIFICATION_STYLES,
  NOTIFICATION_TYPES,
  type NotificationSettings,
  type NotificationType,
  type WrittenNotification,
  platform,
} from "../../lib/platform";

// Notifications the team's admins write for their own team (the platform's POST
// /team/notifications). They go where the team's settings send their type, like Gearbox's.

const DAY_S = 24 * 60 * 60;

const EXPIRY_PRESETS = [
  { label: "1 day", seconds: DAY_S },
  { label: "3 days", seconds: 3 * DAY_S },
  { label: "1 week", seconds: 7 * DAY_S },
  { label: "2 weeks", seconds: 14 * DAY_S },
  { label: "1 month", seconds: 30 * DAY_S },
] as const;

const nowS = () => Math.floor(Date.now() / 1000);

const labelOf = (type: NotificationType) =>
  NOTIFICATION_TYPES.find((t) => t.type === type)?.label ?? type;

/** Where a type goes by the team's saved settings, in words; empty when nowhere. */
function destinations(settings: NotificationSettings["team"][NotificationType], chat: string) {
  return [
    settings.portal === "everyone" && "everyone on the home page",
    settings.portal === "admins" && "admins on the home page",
    settings.channel && `your ${chat} channel`,
  ].filter((d): d is string => !!d);
}

export function TeamNotifications({ settings }: { settings: NotificationSettings }) {
  const [written, setWritten] = useState<WrittenNotification[] | null>(null);
  const [error, setError] = useState("");

  async function reload() {
    try {
      setWritten(await platform<WrittenNotification[]>("/team/notifications/written"));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => {
    reload();
  }, []);

  async function remove(id: string) {
    setError("");
    try {
      await platform(`/team/notifications/${id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <SendForm settings={settings} onSent={reload} />
      {error && <ErrorBanner message={error} />}
      {written && written.length > 0 && (
        <Card title="Sent by your team">
          <ul className="space-y-2">
            {written.map((n) => (
              <WrittenRow key={n.id} notification={n} onDelete={() => remove(n.id)} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function SendForm({
  settings,
  onSent,
}: {
  settings: NotificationSettings;
  onSent: () => Promise<void>;
}) {
  const chat = chatName(useTeamChat());
  const [type, setType] = useState<NotificationType>("info");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [expiry, setExpiry] = useState<number>(7 * DAY_S);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const goesTo = destinations(settings.team[type], chat);

  return (
    <Card title="Send to your team">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setSent(false);
          try {
            await platform("/team/notifications", {
              method: "POST",
              body: {
                type,
                summary: summary.trim(),
                body: body.trim(),
                expiresAt: Math.round((nowS() + expiry) / 60) * 60,
              },
            });
            setSummary("");
            setBody("");
            setSent(true);
            await onSent();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-secondary-700">Type</legend>
          <div className="flex flex-wrap gap-2">
            {NOTIFICATION_TYPES.map((t) => (
              <Chip key={t.type} selected={type === t.type} onClick={() => setType(t.type)}>
                {t.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Field label="Short description">
          <TextField
            kind="announcement"
            required
            maxLength={140}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <Field label="Full text">
          <TextField
            multiline
            kind="announcement"
            required
            maxLength={10_000}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-secondary-700">
            Show on the home page for
          </legend>
          <div className="flex flex-wrap gap-2">
            {EXPIRY_PRESETS.map((p) => (
              <Chip
                key={p.seconds}
                selected={expiry === p.seconds}
                onClick={() => setExpiry(p.seconds)}
              >
                {p.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <p className={`text-sm ${goesTo.length ? "text-secondary-600" : "text-amber-700"}`}>
          {goesTo.length
            ? `Goes to ${goesTo.join(", ")}.`
            : `${labelOf(type)} notifications go nowhere yet. Choose where they go under "From your team" below.`}
        </p>
        {error && <ErrorBanner message={error} />}
        {sent && <SuccessBanner message="Sent." />}
        <Button type="submit" disabled={busy || goesTo.length === 0}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </form>
    </Card>
  );
}

function WrittenRow({
  notification: n,
  onDelete,
}: {
  notification: WrittenNotification;
  onDelete: () => void;
}) {
  const style = NOTIFICATION_STYLES[n.type];
  const expired = n.expiresAt <= nowS();
  return (
    <li
      className={`rounded-lg border border-l-4 border-line bg-surface ${style.stripe} ${expired ? "opacity-70" : ""}`}
    >
      <details>
        <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-inset">
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>
            {labelOf(n.type)}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium text-secondary-900">
            {n.summary}
          </span>
          <span className="hidden shrink-0 text-secondary-500 sm:inline">
            {expired ? "Expired" : `Until ${new Date(n.expiresAt * 1000).toLocaleDateString()}`}
          </span>
        </summary>
        <div className="space-y-3 border-t border-line px-4 py-3 text-sm">
          <p className="whitespace-pre-wrap break-words text-secondary-800">{n.body}</p>
          <p className="text-secondary-500">
            {n.createdByName ?? "A former member"}, {new Date(n.createdAt * 1000).toLocaleString()}
          </p>
          <div className="flex justify-end">
            <ConfirmButton
              size="sm"
              label="Delete"
              question="Delete it? It comes off the home page; messages already sent stay in chat."
              onConfirm={onDelete}
            />
          </div>
        </div>
      </details>
    </li>
  );
}
