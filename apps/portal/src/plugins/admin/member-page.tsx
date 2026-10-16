import {
  Badge,
  Button,
  Card,
  ConfirmQuestion,
  ErrorBanner,
  Loading,
  Page,
  redirectToSignIn,
} from "@g3/ui";
import { GraduationCap, Shield, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { g3id as api } from "../../lib/api";
import { PROVIDERS, ProviderIcon, STATUS_STYLES, type User, relativeTime } from "./members-shared";

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-secondary-500">{label}</dt>
      <dd className="text-right text-secondary-900">{children}</dd>
    </div>
  );
}

export function MemberPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  /** Back to the list as it was (its search and filters). */
  const back = (location.state as { from?: string } | null)?.from ?? "/admin/members";

  const [me, setMe] = useState<string | null>(null);
  const [user, setUser] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.auth.me.$get().then(async (res) => {
      if (res.status === 401) return redirectToSignIn();
      const data = (await res.json()) as { id: string; isAdmin?: boolean };
      if (!res.ok || !data.isAdmin) return navigate("/");
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
    <Page title={user?.displayName ?? "User"} width="narrow">
      <Link to={back} className="text-sm text-secondary-500 hover:text-primary-600">
        ← All users
      </Link>

      {!user && !error && <Loading />}
      {error && <ErrorBanner message={error} />}

      {user && (
        <>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary-500 flex items-center justify-center text-xl font-semibold text-on-primary shrink-0">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-secondary-600">{user.email}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {STATUS_STYLES[user.status] && (
                  <Badge colors={STATUS_STYLES[user.status]}>
                    <span className="capitalize">{user.status}</span>
                  </Badge>
                )}
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

          <Card className="!py-3">
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
          </Card>

          <Card title="Signs in with">
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
          </Card>

          {/* Your own account: only the mentor role (an admin can't remove their own admin or delete
              themselves). */}
          {(!self || user.status === "active") && (
            <section className="flex flex-wrap gap-2">
              {!self && user.status === "pending" && (
                <>
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      act("approve", () => api.admin.users[":id"].approve.$post(param), {
                        status: "active",
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy !== null}
                    onClick={() =>
                      act("reject", () => api.admin.users[":id"].reject.$post(param), {
                        status: "rejected",
                      })
                    }
                  >
                    Reject
                  </Button>
                </>
              )}
              {user.status === "active" && (
                <>
                  {!self && (
                    <Button
                      variant="secondary"
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
                    >
                      {user.isAdmin ? <ShieldOff size={14} /> : <Shield size={14} />}
                      {user.isAdmin ? "Remove admin" : "Make admin"}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
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
                  >
                    <GraduationCap size={14} />
                    {user.isMentor ? "Remove mentor" : "Make mentor"}
                  </Button>
                </>
              )}
              {!self && user.status !== "pending" && !confirmDelete && (
                <Button
                  variant="danger"
                  disabled={busy !== null}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )}
            </section>
          )}

          {confirmDelete && (
            <ConfirmQuestion
              question={`Delete ${user.displayName}? Their account, sign-ins and kiosk PIN are removed for good. This can't be undone.`}
              confirmLabel={busy === "delete" ? "Deleting…" : "Delete"}
              disabled={busy !== null}
              onConfirm={() => act("delete", () => api.admin.users[":id"].$delete(param))}
              onKeep={() => setConfirmDelete(false)}
            />
          )}
        </>
      )}
    </Page>
  );
}
