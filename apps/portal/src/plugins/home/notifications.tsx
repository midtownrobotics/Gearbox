import { useEffect, useState } from "react";
import { FaChevronDown } from "react-icons/fa";
import {
  NOTIFICATION_STYLES,
  NOTIFICATION_TYPES,
  type TeamNotification,
  platform,
} from "../../lib/platform";

// The platform's notifications under the home's apps: the ones the team's admins chose to show
// this member (Notifications, in the admin pages), until they expire. Critical ones first.

const ORDER = { critical: 0, warning: 1, info: 2 } as const;

export function HomeNotifications() {
  const [list, setList] = useState<TeamNotification[]>([]);
  useEffect(() => {
    platform<TeamNotification[]>("/team/notifications")
      .then((all) => setList([...all].sort((a, b) => ORDER[a.type] - ORDER[b.type])))
      // The home works the same without them.
      .catch(() => setList([]));
  }, []);
  if (list.length === 0) return null;

  return (
    <section className="mt-12" aria-labelledby="notifications-heading">
      <h2
        id="notifications-heading"
        className="mb-3 text-sm font-semibold uppercase tracking-widest text-secondary-500"
      >
        Notifications
      </h2>
      <ul className="space-y-2">
        {list.map((n) => (
          <Row key={n.id} notification={n} />
        ))}
      </ul>
    </section>
  );
}

function Row({ notification: n }: { notification: TeamNotification }) {
  const [open, setOpen] = useState(n.type === "critical");
  const style = NOTIFICATION_STYLES[n.type];
  const label = NOTIFICATION_TYPES.find((t) => t.type === n.type)?.label;
  return (
    <li
      className={`overflow-hidden rounded-lg border border-l-4 border-line bg-surface ${style.stripe}`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`home-notification-${n.id}`}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-inset"
      >
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style.badge}`}>
          {label}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-secondary-900">{n.summary}</span>
        <FaChevronDown
          aria-hidden
          className={`shrink-0 text-secondary-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          id={`home-notification-${n.id}`}
          className="border-t border-line px-4 py-3 text-sm text-secondary-800"
        >
          <p className="whitespace-pre-wrap break-words">{n.body}</p>
          <p className="mt-2 text-xs text-secondary-500">
            {new Date(n.createdAt * 1000).toLocaleDateString()}
          </p>
        </div>
      )}
    </li>
  );
}
