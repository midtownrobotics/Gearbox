import { TextField } from "@g3/ui";
import { useEffect, useRef, useState } from "react";
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
import { Notice, Panel, buttonClass, fieldClass } from "./shell";

// Notifications for every team, written by operators, each shown until it expires. Each team's
// admins choose where they go: its home page and Slack (workers/platform/src/notifications.ts).

const TYPES: { type: NotificationType; label: string }[] = [
  { type: "info", label: "Informational" },
  { type: "warning", label: "Warning" },
  { type: "critical", label: "Critical" },
];

const TYPE_STYLES: Record<NotificationType, { badge: string; stripe: string }> = {
  info: { badge: "bg-secondary-100 text-secondary-700", stripe: "border-l-secondary-300" },
  warning: { badge: "bg-amber-100 text-amber-800", stripe: "border-l-amber-500" },
  critical: { badge: "bg-red-100 text-red-800", stripe: "border-l-red-600" },
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
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[type].badge}`}
    >
      {TYPES.find((t) => t.type === type)?.label ?? type}
    </span>
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
    <div className="space-y-4">
      {(error ?? list.error) && <Notice>{error ?? list.error}</Notice>}
      <NewNotification create={create} />
      <Panel title="Active">
        <NotificationList
          notifications={active}
          empty="No active notifications."
          onDelete={setDeleting}
        />
      </Panel>
      {expired.length > 0 && (
        <Panel title="Expired">
          <NotificationList notifications={expired} empty="" onDelete={setDeleting} />
        </Panel>
      )}
      <DeleteDialog
        notification={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={async () => {
          setDeleting(null);
          await list.reload();
        }}
      />
    </div>
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
    <Panel title="New notification">
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
          <legend className="mb-2 text-sm font-medium text-secondary-800">Type</legend>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <label
                key={t.type}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary-300 ${
                  type === t.type
                    ? "border-primary-500 bg-primary-50 text-secondary-900"
                    : "border-line bg-surface text-secondary-700 hover:bg-inset"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={t.type}
                  checked={type === t.type}
                  onChange={() => setType(t.type)}
                  className="sr-only"
                />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm">
          <span className="font-medium text-secondary-800">Short description</span>
          <TextField
            variant="plain"
            kind="note"
            required
            maxLength={140}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-secondary-800">Full text</span>
          <TextField
            multiline
            variant="plain"
            kind="note"
            required
            maxLength={10_000}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-secondary-800">Expires</legend>
          <div className="flex flex-wrap items-center gap-2">
            {EXPIRY_PRESETS.map((p) => (
              <button
                key={p.seconds}
                type="button"
                aria-pressed={expiry === p.seconds}
                onClick={() => setExpiry(p.seconds)}
                className={chipClass(expiry === p.seconds)}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={expiry === "custom"}
              onClick={() => setExpiry("custom")}
              className={chipClass(expiry === "custom")}
            >
              Pick a date
            </button>
            {expiry === "custom" && (
              <input
                type="datetime-local"
                required
                value={customAt}
                min={toLocalInput(nowS())}
                max={toLocalInput(nowS() + 365 * DAY_S)}
                onChange={(e) => setCustomAt(e.target.value)}
                className={`${fieldClass} w-auto`}
                aria-label="Expiry date and time"
              />
            )}
          </div>
          {Number.isFinite(expiresAt) && (
            <p className="mt-2 text-sm text-secondary-600">Expires {formatTime(expiresAt)}</p>
          )}
        </fieldset>
        <button type="submit" disabled={busy} className={buttonClass("primary")}>
          {busy ? "Creating…" : "Create"}
        </button>
      </form>
    </Panel>
  );
}

function chipClass(selected: boolean) {
  return `rounded-full border px-3 py-1 text-sm ${
    selected
      ? "border-primary-500 bg-primary-50 font-semibold text-secondary-900"
      : "border-line bg-surface text-secondary-700 hover:bg-inset"
  }`;
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
            <button
              type="button"
              onClick={onDelete}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              <FaTrash aria-hidden /> Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Asks before deleting, in a dialog over the page. */
function DeleteDialog({
  notification,
  onClose,
  onDeleted,
}: {
  notification: Notification | null;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (notification && !dialog.open) {
      setError(null);
      dialog.showModal();
    } else if (!notification && dialog.open) {
      dialog.close();
    }
  }, [notification]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && !busy && onClose()}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-xl border border-line bg-surface p-0 text-secondary-900 shadow-xl backdrop:bg-black/40"
    >
      {notification && (
        <div className="space-y-4 p-5">
          <h2 className="text-lg font-semibold">Delete this notification?</h2>
          <div className="flex items-center gap-2 rounded-lg bg-inset px-3 py-2 text-sm">
            <TypeBadge type={notification.type} />
            <span className="min-w-0 truncate">{notification.summary}</span>
          </div>
          <p className="text-sm text-secondary-600">This can't be undone.</p>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} className={buttonClass()} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              className={buttonClass("danger")}
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
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
