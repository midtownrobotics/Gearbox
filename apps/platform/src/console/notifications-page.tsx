import {
  Badge,
  Button,
  Card,
  Chip,
  Dialog,
  ErrorBanner,
  Field,
  Page,
  TextField,
  inputClass,
  tones,
} from "@g3/ui";
import { useState } from "react";
import { FaChevronDown, FaTrash } from "react-icons/fa";
import {
  type Notification,
  type NotificationType,
  consoleApi,
  formatTime,
  read,
  send,
  useLoad,
} from "./data";

// Notifications for every team, written by operators, each shown until it expires. Each team's
// admins choose where they go: its home page and Slack (workers/platform/src/notifications.ts).

const TYPES: { type: NotificationType; label: string }[] = [
  { type: "info", label: "Informational" },
  { type: "warning", label: "Warning" },
  { type: "critical", label: "Critical" },
];

const TYPE_STYLES: Record<NotificationType, { badge: string; stripe: string }> = {
  info: { badge: tones.info, stripe: "border-l-sky-400" },
  warning: { badge: tones.warning, stripe: "border-l-amber-500" },
  critical: { badge: tones.danger, stripe: "border-l-red-600" },
};

const DAY_S = 24 * 60 * 60;

/** How long a new notification lasts. */
const EXPIRY_PRESETS = [
  { label: "1 day", seconds: DAY_S },
  { label: "3 days", seconds: 3 * DAY_S },
  { label: "1 week", seconds: 7 * DAY_S },
  { label: "2 weeks", seconds: 14 * DAY_S },
  { label: "1 month", seconds: 30 * DAY_S },
] as const;

const nowS = () => Math.floor(Date.now() / 1000);

/** Unix seconds as a datetime-local input's value, in the viewer's time. */
function toLocalInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "in 3 days", "in 5 hours", "2 days ago". */
function relative(seconds: number): string {
  const diff = seconds - nowS();
  const abs = Math.abs(diff);
  const [n, unit] =
    abs >= DAY_S
      ? [Math.round(abs / DAY_S), "day"]
      : abs >= 3600
        ? [Math.round(abs / 3600), "hour"]
        : [Math.max(1, Math.round(abs / 60)), "minute"];
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

function TypeBadge({ type }: { type: NotificationType }) {
  return (
    <Badge colors={TYPE_STYLES[type].badge}>
      {TYPES.find((t) => t.type === type)?.label ?? type}
    </Badge>
  );
}

export function NotificationsPage() {
  const list = useLoad(() => read<Notification[]>(consoleApi.notifications.$get()), []);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Notification | null>(null);

  async function create(input: {
    type: NotificationType;
    summary: string;
    body: string;
    expiresAt: number;
  }): Promise<boolean> {
    setError(null);
    try {
      await send("POST", "/notifications", input);
      await list.reload();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  const all = list.data ?? [];
  const active = all.filter((n) => n.expiresAt > nowS());
  const expired = all.filter((n) => n.expiresAt <= nowS());

  return (
    <Page title="Notifications">
      {(error ?? list.error) && <ErrorBanner message={error ?? list.error ?? ""} />}
      <NewNotification create={create} />
      <Card title="Active">
        <NotificationList
          notifications={active}
          empty="No active notifications."
          onDelete={setDeleting}
        />
      </Card>
      {expired.length > 0 && (
        <Card title="Expired">
          <NotificationList notifications={expired} empty="" onDelete={setDeleting} />
        </Card>
      )}
      <DeleteDialog
        key={deleting?.id}
        notification={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={async () => {
          setDeleting(null);
          await list.reload();
        }}
      />
    </Page>
  );
}

function NewNotification({
  create,
}: {
  create: (input: {
    type: NotificationType;
    summary: string;
    body: string;
    expiresAt: number;
  }) => Promise<boolean>;
}) {
  const [type, setType] = useState<NotificationType>("info");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  /** A preset's length in seconds, or "custom" for the date picker. */
  const [expiry, setExpiry] = useState<number | "custom">(7 * DAY_S);
  const [customAt, setCustomAt] = useState(() => toLocalInput(nowS() + 7 * DAY_S));
  const [busy, setBusy] = useState(false);

  const expiresAt =
    expiry === "custom"
      ? Math.floor(new Date(customAt).getTime() / 1000)
      : // Rounded to the minute, so the preview and what's saved agree.
        Math.round((nowS() + expiry) / 60) * 60;

  return (
    <Card title="New notification">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          if (await create({ type, summary: summary.trim(), body: body.trim(), expiresAt })) {
            setType("info");
            setSummary("");
            setBody("");
            setExpiry(7 * DAY_S);
          }
          setBusy(false);
        }}
      >
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-secondary-700">Type</legend>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <Chip key={t.type} selected={type === t.type} onClick={() => setType(t.type)}>
                {t.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Field label="Short description">
          <TextField
            kind="note"
            required
            maxLength={140}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </Field>
        <Field label="Full text">
          <TextField
            multiline
            kind="note"
            required
            maxLength={10_000}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-secondary-700">Expires</legend>
          <div className="flex flex-wrap items-center gap-2">
            {EXPIRY_PRESETS.map((p) => (
              <Chip
                key={p.seconds}
                selected={expiry === p.seconds}
                onClick={() => setExpiry(p.seconds)}
              >
                {p.label}
              </Chip>
            ))}
            <Chip selected={expiry === "custom"} onClick={() => setExpiry("custom")}>
              Pick a date
            </Chip>
            {expiry === "custom" && (
              <input
                type="datetime-local"
                required
                value={customAt}
                min={toLocalInput(nowS())}
                max={toLocalInput(nowS() + 365 * DAY_S)}
                onChange={(e) => setCustomAt(e.target.value)}
                className={`${inputClass} max-w-64`}
                aria-label="Expiry date and time"
              />
            )}
          </div>
          {Number.isFinite(expiresAt) && (
            <p className="mt-2 text-sm text-secondary-600">Expires {formatTime(expiresAt)}</p>
          )}
        </fieldset>
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </form>
    </Card>
  );
}

function NotificationList({
  notifications,
  empty,
  onDelete,
}: {
  notifications: Notification[];
  empty: string;
  onDelete: (n: Notification) => void;
}) {
  if (notifications.length === 0) return <p className="text-sm text-secondary-500">{empty}</p>;
  return (
    <ul className="space-y-2">
      {notifications.map((n) => (
        <NotificationRow key={n.id} notification={n} onDelete={() => onDelete(n)} />
      ))}
    </ul>
  );
}

function NotificationRow({
  notification: n,
  onDelete,
}: {
  notification: Notification;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const expired = n.expiresAt <= nowS();
  const bodyId = `notification-${n.id}`;

  return (
    <li
      className={`overflow-hidden rounded-lg border border-l-4 border-line bg-surface ${TYPE_STYLES[n.type].stripe} ${expired ? "opacity-70" : ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-inset"
      >
        <TypeBadge type={n.type} />
        <span className="min-w-0 flex-1 truncate font-medium text-secondary-900">{n.summary}</span>
        <span className="hidden shrink-0 text-secondary-500 sm:inline">
          {expired ? "Expired" : "Expires"} {relative(n.expiresAt)}
        </span>
        <FaChevronDown
          aria-hidden
          className={`shrink-0 text-secondary-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={bodyId} className="space-y-3 border-t border-line px-4 py-3 text-sm">
          <p className="whitespace-pre-wrap break-words text-secondary-800">{n.body}</p>
          <dl className="grid gap-x-6 gap-y-1 text-secondary-600 sm:grid-cols-[auto_1fr]">
            <dt className="font-medium text-secondary-700">Written by</dt>
            <dd>
              {n.createdByName}, {formatTime(n.createdAt)}
            </dd>
            <dt className="font-medium text-secondary-700">{expired ? "Expired" : "Expires"}</dt>
            <dd>
              {formatTime(n.expiresAt)} ({relative(n.expiresAt)})
            </dd>
          </dl>
          <div className="flex justify-end">
            <Button variant="danger" size="sm" onClick={onDelete}>
              <FaTrash aria-hidden /> Delete
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Asks before deleting, in a pop-up over the page. */
function DeleteDialog({
  notification,
  onClose,
  onDeleted,
}: {
  notification: Notification | null;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!notification) return null;
  return (
    <Dialog title="Delete this notification?" onClose={() => !busy && onClose()}>
      <div className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2 text-sm">
        <TypeBadge type={notification.type} />
        <span className="min-w-0 truncate text-secondary-900">{notification.summary}</span>
      </div>
      <p className="text-sm text-secondary-600">This can't be undone.</p>
      {error && <ErrorBanner message={error} />}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await send("DELETE", `/notifications/${notification.id}`);
              await onDeleted();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </Dialog>
  );
}
