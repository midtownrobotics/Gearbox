import { ArrowLeft, GraduationCap, Loader2, Shield, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../../lib/api";
import { PROVIDERS, ProviderIcon, STATUS_STYLES, type User, relativeTime } from "./users-shared";

// One member of the team, opened from the Users list: their details, the accounts they sign in
// with, and what an admin can do for them.

type Details = Omit<User, "identities"> & {
  identities: User["identities"];
  /** When their kiosk PIN was made, or null when they have none. */
  kioskPinSince: number | null;
};

const longDate = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const buttonClass =
  "px-3 py-1.5 rounded-lg text-sm font-medium bg-surface border border-secondary-300 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-secondary-700 transition-colors flex items-center gap-1.5";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-secondary-500">{label}</dt>
      <dd className="text-right text-secondary-900">{children}</dd>
    </div>
  );
}

export function AdminUserPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  /** Back to the list as it was (its search and filters). */
  const back = (location.state as { from?: string } | null)?.from ?? "/admin/users";

  const [me, setMe] = useState<string | null>(null);
  const [user, setUser] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.auth.me.$get().then(async (res) => {
      if (res.status === 401) return navigate("/login");
      const data = (await res.json()) as { id: string; isAdmin?: boolean };
      if (!res.ok || !data.isAdmin) return navigate("/dashboard");
      setMe(data.id);
    });
  }, [navigate]);

  useEffect(() => {
    if (!me) return;
    api.admin.users[":id"]
      .$get({ param: { id } })
      .then(async (res) => {
        if (res.status === 404) throw new Error("This person isn't on your team.");
        if (!res.ok) throw new Error("Couldn't load this person.");
        setUser((await res.json()) as Details);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this person."));
  }, [me, id]);

  /** Runs an action on them; on success, applies `patch` (or leaves the page, for a delete). */
  async function act(
    name: string,
    run: () => Promise<{ ok: boolean; json(): Promise<unknown> }>,
    patch?: Partial<Details>,
  ) {
    setBusy(name);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "That didn't work. Try again.");
      }
      if (patch) setUser((u) => (u ? { ...u, ...patch } : u));
      else navigate(back);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const param = { param: { id } };
  const self = user?.id === me;

  return (
    <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
      <Link
        to={back}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-secondary-600 hover:text-primary-600"
      >
        <ArrowLeft size={14} /> Users
      </Link>

      {!user && !error && (
        <div className="flex justify-center py-16 text-secondary-500">
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}
      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {user && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary-500 flex items-center justify-center text-xl font-semibold text-white shrink-0">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-secondary-900">{user.displayName}</h1>
              <p className="truncate text-sm text-secondary-600">{user.email}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLES[user.status] ?? "bg-surface text-secondary-600"}`}
                >
                  {user.status}
                </span>
                {user.isAdmin === 1 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary-50 text-primary-600 border border-primary-200">
                    Admin
                  </span>
                )}
                {user.isMentor === 1 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                    Mentor
                  </span>
                )}
              </div>
            </div>
          </div>

          <section className="bg-surface border border-secondary-200 rounded-lg px-5 py-3">
            <dl className="divide-y divide-secondary-200">
              <Row label="Joined">{longDate(user.createdAt)}</Row>
              <Row label="Last signed in">
                {user.lastLoginAt
                  ? `${longDate(user.lastLoginAt)} (${relativeTime(user.lastLoginAt)})`
                  : "Never"}
              </Row>
              <Row label="Kiosk PIN">
                {user.kioskPinSince ? `Since ${longDate(user.kioskPinSince)}` : "None"}
              </Row>
            </dl>
          </section>

          <section className="bg-surface border border-secondary-200 rounded-lg px-5 py-4">
            <h2 className="mb-3 text-sm font-semibold text-secondary-900">Signs in with</h2>
            {user.identities.length === 0 ? (
              <p className="text-sm text-secondary-500">No linked accounts.</p>
            ) : (
              <ul className="space-y-2">
                {user.identities.map((identity) => (
                  <li
                    key={`${identity.provider}-${identity.createdAt}`}
                    className="flex items-center gap-3 text-sm"
                  >
                    <ProviderIcon provider={identity.provider} />
                    <span className="font-medium text-secondary-900">
                      {PROVIDERS[identity.provider] ?? identity.provider}
                    </span>
                    {identity.providerEmail && (
                      <span className="min-w-0 truncate text-secondary-600">
                        {identity.providerEmail}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-xs text-secondary-500">
                      linked {longDate(identity.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!self && (
            <section className="flex flex-wrap gap-2">
              {user.status === "pending" && (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      act("approve", () => api.admin.users[":id"].approve.$post(param), {
                        status: "active",
                      })
                    }
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      act("reject", () => api.admin.users[":id"].reject.$post(param), {
                        status: "rejected",
                      })
                    }
                    className={buttonClass}
                  >
                    Reject
                  </button>
                </>
              )}
              {user.status === "active" && (
                <>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      user.isAdmin
                        ? act("admin", () => api.admin.users[":id"].demote.$post(param), {
                            isAdmin: 0,
                          })
                        : act("admin", () => api.admin.users[":id"].promote.$post(param), {
                            isAdmin: 1,
                          })
                    }
                    className={buttonClass}
                  >
                    {user.isAdmin ? <ShieldOff size={14} /> : <Shield size={14} />}
                    {user.isAdmin ? "Remove admin" : "Make admin"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      user.isMentor
                        ? act(
                            "mentor",
                            () => api.admin.users[":id"]["revoke-mentor"].$post(param),
                            {
                              isMentor: 0,
                            },
                          )
                        : act("mentor", () => api.admin.users[":id"]["grant-mentor"].$post(param), {
                            isMentor: 1,
                          })
                    }
                    className={buttonClass}
                  >
                    <GraduationCap size={14} />
                    {user.isMentor ? "Remove mentor" : "Make mentor"}
                  </button>
                </>
              )}
              {user.status !== "pending" && !confirmDelete && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirmDelete(true)}
                  className={`${buttonClass} hover:text-red-700 hover:bg-red-50`}
                >
                  Delete
                </button>
              )}
            </section>
          )}

          {confirmDelete && (
            <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
              <p className="text-red-800">
                Delete {user.displayName}? Their account, sign-ins and kiosk PIN are removed for
                good. This can't be undone.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => act("delete", () => api.admin.users[":id"].$delete(param))}
                  className="px-3 py-1.5 rounded-lg font-semibold bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white flex items-center gap-1.5"
                >
                  {busy === "delete" && <Loader2 size={14} className="animate-spin" />}
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 text-secondary-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
