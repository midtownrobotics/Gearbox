import { apiPath } from "@g3/site-config";
import { Loader2, LogOut, Minus, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";

// What admins do on the Attendance Settings page: sign out whoever is signed in, add or take away
// a member's hours, and remove a member. Each change loads the page's members again.

/** A member as the attendance worker's summary gives them. */
export type MemberSummary = {
  id: string;
  displayName: string;
  signedIn: boolean;
  /** When they last signed in: for someone signed in, when this visit began. */
  lastSignIn: string | null;
  totalHours: number;
};

const ATTENDANCE_API_URL = apiPath("attendance");

/** Calls the attendance worker, and gives its answer or throws its error. */
async function send<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${ATTENDANCE_API_URL}${path}`, { credentials: "include", ...init });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Attendance update failed.");
  return data;
}

const memberPath = (id: string) => `/admin/members/${encodeURIComponent(id)}`;

const quietButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-secondary-300 bg-surface px-3 py-1.5 text-sm font-medium text-secondary-700 hover:bg-secondary-50 disabled:cursor-not-allowed disabled:opacity-50";
const signOutButton =
  "inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50";

type Changed = () => Promise<void>;

function Panel({
  title,
  action,
  children,
}: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-secondary-200 bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="text-lg font-bold text-secondary-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Everyone signed in right now, each with a Sign out button, and one for all of them. */
export function SignedInPanel({
  members,
  onChanged,
}: { members: MemberSummary[]; onChanged: Changed }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signedIn = members
    .filter((member) => member.signedIn)
    .map((member) => ({ member, since: member.lastSignIn ? new Date(member.lastSignIn) : null }));

  async function run(key: string, path: string) {
    setBusy(key);
    setError(null);
    try {
      await send(path, { method: "POST" });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attendance update failed.");
    } finally {
      setBusy(null);
      setAsking(false);
    }
  }

  const today = new Date().toDateString();
  const since = (at: Date) =>
    at.toLocaleString(undefined, {
      ...(at.toDateString() === today ? {} : { weekday: "short" }),
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <Panel
      title={`Signed in now · ${signedIn.length}`}
      action={
        signedIn.length === 0 ? null : asking ? (
          // Asked here, not with the browser's own confirm box, which some browsers answer "no" to.
          <span className="flex flex-wrap items-center gap-2 text-sm text-secondary-700">
            Sign out all {signedIn.length}?
            <button
              type="button"
              className={signOutButton}
              disabled={busy !== null}
              onClick={() => run("all", "/admin/signout-all")}
            >
              {busy === "all" && <Loader2 size={14} className="animate-spin" />}
              Sign out
            </button>
            <button
              type="button"
              className={quietButton}
              disabled={busy !== null}
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={signOutButton}
            disabled={busy !== null}
            onClick={() => setAsking(true)}
          >
            <LogOut size={14} />
            Sign Out All
          </button>
        )
      }
    >
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {signedIn.length === 0 ? (
        <p className="text-sm text-secondary-600">No one is signed in.</p>
      ) : (
        <ul className="divide-y divide-secondary-200">
          {signedIn.map(({ member, since: at }) => (
            <li key={member.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-secondary-900">
                  {member.displayName}
                </span>
                {at && <span className="block text-xs text-secondary-500">Since {since(at)}</span>}
              </span>
              <button
                type="button"
                className={quietButton}
                disabled={busy !== null}
                aria-label={`Sign out ${member.displayName}`}
                onClick={() => run(member.id, `${memberPath(member.id)}/signout`)}
              >
                {busy === member.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <LogOut size={14} />
                )}
                Sign out
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const fieldClass =
  "rounded-lg border border-secondary-300 bg-surface px-3 py-1.5 text-sm text-secondary-900 focus:border-primary-500 focus:outline-none";

/** Adds or takes away a member's hours for the school year, or removes the member. */
export function ManageMemberPanel({
  members,
  onChanged,
}: { members: MemberSummary[]; onChanged: Changed }) {
  const [memberId, setMemberId] = useState("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState<"add" | "subtract" | "remove" | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const member = members.find((m) => m.id === memberId);
  if (members.length === 0) return null;

  async function run(action: "add" | "subtract" | "remove", work: () => Promise<string>) {
    setBusy(action);
    setError(null);
    setDone(null);
    try {
      const message = await work();
      await onChanged();
      setDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Attendance update failed.");
    } finally {
      setBusy(null);
      setAsking(false);
    }
  }

  function adjust(direction: 1 | -1) {
    if (!member) return setError("Choose a member.");
    const amount = Number(hours);
    if (!Number.isFinite(amount) || amount <= 0) {
      return setError(`Enter a positive number of hours for ${member.displayName}.`);
    }
    void run(direction === 1 ? "add" : "subtract", async () => {
      const { totalHours } = await send<{ totalHours: number }>(
        `${memberPath(member.id)}/add-hours`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hours: amount * direction }),
        },
      );
      setHours("");
      return `${member.displayName} now has ${totalHours.toFixed(1)} hours.`;
    });
  }

  function remove() {
    if (!member) return;
    void run("remove", async () => {
      await send(memberPath(member.id), { method: "DELETE" });
      setMemberId("");
      return `${member.displayName} was removed.`;
    });
  }

  return (
    <Panel title="Manage a member">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={memberId}
          onChange={(e) => {
            setMemberId(e.target.value);
            setAsking(false);
            setError(null);
            setDone(null);
          }}
          className={`${fieldClass} min-w-0 max-w-full sm:max-w-56`}
          aria-label="Member"
        >
          <option value="">Choose a member…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} ({m.totalHours.toFixed(1)} h)
            </option>
          ))}
        </select>
        <input
          type="number"
          min="0.1"
          max="1000"
          step="0.1"
          inputMode="decimal"
          placeholder="Hours"
          aria-label="Hours to add or subtract"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className={`${fieldClass} attendance-hours-input w-24`}
        />
        <button
          type="button"
          className={quietButton}
          disabled={busy !== null || !member || !hours}
          aria-label="Add hours"
          onClick={() => adjust(1)}
        >
          {busy === "add" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Add
        </button>
        <button
          type="button"
          className={quietButton}
          disabled={busy !== null || !member || !hours}
          aria-label="Subtract hours"
          onClick={() => adjust(-1)}
        >
          {busy === "subtract" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Minus size={14} />
          )}
          Subtract
        </button>
        {!asking && (
          <button
            type="button"
            className={`${quietButton} sm:ml-auto`}
            disabled={busy !== null || !member}
            onClick={() => setAsking(true)}
          >
            <Trash2 size={14} />
            Remove member
          </button>
        )}
      </div>
      {asking && member && (
        <div className="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">
            Remove {member.displayName} and all of their attendance history? This can't be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={signOutButton}
              disabled={busy !== null}
              onClick={remove}
            >
              {busy === "remove" && <Loader2 size={14} className="animate-spin" />}
              Remove {member.displayName}
            </button>
            <button
              type="button"
              className={quietButton}
              disabled={busy !== null}
              onClick={() => setAsking(false)}
            >
              Keep
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {done && (
        <p role="status" className="mt-3 text-sm text-secondary-700">
          {done}
        </p>
      )}
    </Panel>
  );
}
