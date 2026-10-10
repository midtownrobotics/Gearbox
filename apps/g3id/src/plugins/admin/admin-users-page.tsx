import { OnShapeIcon } from "@g3/ui";
import { GraduationCap, Loader2, Shield, ShieldOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FaGithub, FaGoogle, FaKey, FaSlack, FaSteam } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

type Identity = { provider: string; createdAt: number };

type User = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  isAdmin: number;
  isMentor: number;
  createdAt: number;
  lastLoginAt: number | null;
  identities: Identity[];
};

function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-primary-50 text-primary-600 border-primary-200",
};

function ProviderIcon({ provider }: { provider: string }) {
  const cls = "w-4 h-4";
  switch (provider) {
    case "google":
      return (
        <span className={`${cls} text-blue-700`} title="Google">
          <FaGoogle />
        </span>
      );
    case "slack":
      return (
        <span className={`${cls} text-primary-500`} title="Slack">
          <FaSlack />
        </span>
      );
    case "github":
      return (
        <span className={`${cls} text-secondary-700`} title="GitHub">
          <FaGithub />
        </span>
      );
    case "steam":
      return (
        <span className={`${cls} text-cyan-700`} title="Steam">
          <FaSteam />
        </span>
      );
    case "local":
      return (
        <span className={`${cls} text-amber-700`} title="Password">
          <FaKey />
        </span>
      );
    case "onshape":
      return (
        <span className={`${cls} text-green-700`} title="Onshape">
          <OnShapeIcon size={16} onshape-green />
        </span>
      );
    default:
      return <span className="text-xs text-secondary-500">{provider}</span>;
  }
}

const FILTERS = ["pending", "active", "rejected", "all"] as const;
type Filter = (typeof FILTERS)[number];

/** The orders the list can be put in. Someone who has never logged in is always last. */
const SORTS = {
  "joined-new": { label: "Joined: newest first", by: "joined", descending: true },
  "joined-old": { label: "Joined: oldest first", by: "joined", descending: false },
  "name-az": { label: "Name: A to Z", by: "name", descending: false },
  "name-za": { label: "Name: Z to A", by: "name", descending: true },
  "login-new": { label: "Last login: most recent first", by: "login", descending: true },
  "login-old": { label: "Last login: longest ago first", by: "login", descending: false },
} as const;
type Sort = keyof typeof SORTS;

const ROLES = {
  admin: { label: "Admins", has: (u: User) => u.isAdmin === 1 },
  mentor: { label: "Mentors", has: (u: User) => u.isMentor === 1 },
  none: { label: "Neither", has: (u: User) => u.isAdmin !== 1 && u.isMentor !== 1 },
} as const;
type Role = keyof typeof ROLES;

/** Sign-in providers by the name people know them by, in the order they're offered. */
const PROVIDERS: Record<string, string> = {
  slack: "Slack",
  google: "Google",
  github: "GitHub",
  steam: "Steam",
  onshape: "Onshape",
  local: "Password",
};

function sortUsers(users: User[], sort: Sort): User[] {
  const { by, descending } = SORTS[sort];
  const direction = descending ? -1 : 1;
  return [...users].sort((a, b) => {
    if (by === "name") {
      return (
        direction * a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
      );
    }
    if (by === "joined") return direction * (a.createdAt - b.createdAt);
    if (a.lastLoginAt === null || b.lastLoginAt === null) {
      return Number(a.lastLoginAt === null) - Number(b.lastLoginAt === null);
    }
    return direction * (a.lastLoginAt - b.lastLoginAt);
  });
}

const selectClass =
  "rounded-lg bg-surface border border-secondary-300 px-3 py-1.5 text-sm text-secondary-900 focus:outline-none focus:border-primary-500";

export function AdminUsersPage() {
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [sort, setSort] = useState<Sort>("joined-new");
  const [role, setRole] = useState<Role | "">("");
  const [provider, setProvider] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [promoting, setPromoting] = useState<Set<string>>(new Set());
  const [togglingMentor, setTogglingMentor] = useState<Set<string>>(new Set());
  const [mergingUserId, setMergingUserId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeLoading, setMergeLoading] = useState(false);

  useEffect(() => {
    api.auth.me.$get().then(async (res) => {
      if (res.status === 401) {
        navigate("/login");
        return;
      }
      const data = (await res.json()) as { id: string; isAdmin?: boolean };
      if (!res.ok || !data.isAdmin) {
        navigate("/dashboard");
        return;
      }
      setCurrentUserId(data.id);
    });
  }, [navigate]);

  useEffect(() => {
    if (!currentUserId) return;
    api.admin.users
      .$get()
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load users.");
        setUsers((await res.json()) as User[]);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."))
      .finally(() => setLoading(false));
  }, [currentUserId]);

  function updateUser(userId: string, patch: Partial<User>) {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...patch } : u)));
  }

  async function handleApprove(userId: string) {
    setApproving((prev) => new Set(prev).add(userId));
    try {
      const res = await api.admin.users[":id"].approve.$post({ param: { id: userId } });
      if (res.ok) updateUser(userId, { status: "active" });
    } finally {
      setApproving((prev) => {
        const n = new Set(prev);
        n.delete(userId);
        return n;
      });
    }
  }

  async function handleReject(userId: string) {
    setRejecting((prev) => new Set(prev).add(userId));
    try {
      const res = await api.admin.users[":id"].reject.$post({ param: { id: userId } });
      if (res.ok) updateUser(userId, { status: "rejected" });
    } finally {
      setRejecting((prev) => {
        const n = new Set(prev);
        n.delete(userId);
        return n;
      });
    }
  }

  async function handleDelete(userId: string) {
    if (!window.confirm("Permanently delete this user and all their data?")) return;
    setDeleting((prev) => new Set(prev).add(userId));
    try {
      const res = await api.admin.users[":id"].$delete({ param: { id: userId } });
      if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== userId));
    } finally {
      setDeleting((prev) => {
        const n = new Set(prev);
        n.delete(userId);
        return n;
      });
    }
  }

  async function handlePromote(userId: string) {
    setPromoting((prev) => new Set(prev).add(userId));
    try {
      const res = await api.admin.users[":id"].promote.$post({ param: { id: userId } });
      if (res.ok) updateUser(userId, { isAdmin: 1 });
    } finally {
      setPromoting((prev) => {
        const n = new Set(prev);
        n.delete(userId);
        return n;
      });
    }
  }

  async function handleDemote(userId: string) {
    setPromoting((prev) => new Set(prev).add(userId));
    try {
      const res = await api.admin.users[":id"].demote.$post({ param: { id: userId } });
      if (res.ok) updateUser(userId, { isAdmin: 0 });
    } finally {
      setPromoting((prev) => {
        const n = new Set(prev);
        n.delete(userId);
        return n;
      });
    }
  }

  async function handleGrantMentor(userId: string) {
    setTogglingMentor((prev) => new Set(prev).add(userId));
    try {
      const res = await api.admin.users[":id"]["grant-mentor"].$post({ param: { id: userId } });
      if (res.ok) updateUser(userId, { isMentor: 1 });
    } finally {
      setTogglingMentor((prev) => {
        const n = new Set(prev);
        n.delete(userId);
        return n;
      });
    }
  }

  async function handleRevokeMentor(userId: string) {
    setTogglingMentor((prev) => new Set(prev).add(userId));
    try {
      const res = await api.admin.users[":id"]["revoke-mentor"].$post({ param: { id: userId } });
      if (res.ok) updateUser(userId, { isMentor: 0 });
    } finally {
      setTogglingMentor((prev) => {
        const n = new Set(prev);
        n.delete(userId);
        return n;
      });
    }
  }

  async function handleMerge(userId: string) {
    if (!mergeTargetId) return;
    setMergeLoading(true);
    try {
      // biome-ignore lint/suspicious/noExplicitAny: merge route has no body validator
      const res = await (api.admin.users[":id"].merge.$post as any)({
        param: { id: userId },
        json: { targetUserId: mergeTargetId },
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        setMergingUserId(null);
        setMergeTargetId("");
      }
    } finally {
      setMergeLoading(false);
    }
  }

  // The role and sign-in filters narrow every tab, so each tab's count is of what it would show.
  const matching = useMemo(
    () =>
      users.filter(
        (u) =>
          (role === "" || ROLES[role].has(u)) &&
          (provider === "" || u.identities.some((identity) => identity.provider === provider)),
      ),
    [users, role, provider],
  );
  const filtered = useMemo(
    () =>
      sortUsers(filter === "all" ? matching : matching.filter((u) => u.status === filter), sort),
    [matching, filter, sort],
  );
  const countFor = (f: Filter) =>
    f === "all" ? matching.length : matching.filter((u) => u.status === f).length;
  // The providers to offer: the usual ones, then any other that someone here signs in with.
  const providers = [
    ...new Set([
      ...Object.keys(PROVIDERS),
      ...users.flatMap((u) => u.identities.map((i) => i.provider)),
    ]),
  ];

  function exportActiveUsersToCSV() {
    const activeUsers = users.filter((u) => u.status === "active");
    if (activeUsers.length === 0) return;

    const authMethods = ["Slack", "Google", "GitHub", "Steam", "OnShape"];
    const headers = [
      "Name",
      "Email",
      "Joined Date",
      "Last Login",
      "Admin",
      "Mentor",
      ...authMethods,
    ];

    const rows = activeUsers.map((u) => {
      const providerSet = new Set(u.identities.map((i) => i.provider));
      const authValues = {
        slack: providerSet.has("slack"),
        google: providerSet.has("google"),
        github: providerSet.has("github"),
        steam: providerSet.has("steam"),
        onshape: providerSet.has("onshape"),
      };
      return [
        u.displayName,
        u.email,
        new Date(u.createdAt * 1000).toLocaleDateString(),
        u.lastLoginAt ? new Date(u.lastLoginAt * 1000).toLocaleString() : "Never",
        u.isAdmin ? "TRUE" : "FALSE",
        u.isMentor ? "TRUE" : "FALSE",
        authValues.slack ? "TRUE" : "FALSE",
        authValues.google ? "TRUE" : "FALSE",
        authValues.github ? "TRUE" : "FALSE",
        authValues.steam ? "TRUE" : "FALSE",
        authValues.onshape ? "TRUE" : "FALSE",
      ];
    });

    const csv = [
      headers.map((h) => `"${h}"`).join(","),
      ...rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `g3id-active-users-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  }

  return (
    <main className="flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-secondary-900">Users</h1>
        <button
          type="button"
          onClick={exportActiveUsersToCSV}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-primary-500 hover:bg-primary-600 text-white transition-colors"
        >
          Export Active Users (CSV)
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              filter === f
                ? "bg-primary-500 text-white"
                : "bg-surface text-secondary-600 hover:text-secondary-900 border border-secondary-300"
            }`}
          >
            {f} <span className="opacity-60">({countFor(f)})</span>
          </button>
        ))}
      </div>

      {/* Sort, and filter by role and sign-in */}
      <div className="flex flex-wrap gap-2 mb-6">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className={selectClass}
          aria-label="Sort by"
        >
          {Object.entries(SORTS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role | "")}
          className={selectClass}
          aria-label="Role"
        >
          <option value="">Any role</option>
          {Object.entries(ROLES).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className={selectClass}
          aria-label="Sign-in"
        >
          <option value="">Any sign-in</option>
          {providers.map((key) => (
            <option key={key} value={key}>
              {PROVIDERS[key] ?? key}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <div className="flex justify-center py-16 text-secondary-500">
          <Loader2 size={24} className="animate-spin" />
        </div>
      )}

      {error && <p className="text-sm text-primary-500">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-secondary-500 text-center py-16">
          {role || provider
            ? "No users match."
            : `No ${filter === "all" ? "" : `${filter} `}users.`}
        </p>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {filtered.map((user) => (
            <div
              key={user.id}
              className="bg-surface border border-secondary-200 rounded-lg overflow-hidden"
            >
              {/* Main row */}
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-primary-500 flex items-center justify-center text-sm font-semibold text-white shrink-0">
                  {user.displayName.charAt(0).toUpperCase()}
                </div>

                {/* Name + identity icons */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-secondary-900 font-semibold">{user.displayName}</span>
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
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLES[user.status] ?? "bg-surface text-secondary-600"}`}
                    >
                      {user.status}
                    </span>
                  </div>
                  {/* Identity icons + timestamps */}
                  <div className="flex items-center gap-2 mt-1">
                    {user.identities.map((identity) => (
                      <ProviderIcon key={identity.provider} provider={identity.provider} />
                    ))}
                    <span className="text-xs text-secondary-500">·</span>
                    <span className="text-xs text-secondary-500" title="Last login">
                      {user.lastLoginAt ? relativeTime(user.lastLoginAt) : "never logged in"}
                    </span>
                    <span className="text-xs text-secondary-500">·</span>
                    <span className="text-xs text-secondary-500" title="Joined">
                      joined {relativeTime(user.createdAt)}
                    </span>
                  </div>
                </div>

                {/* Action buttons — full width on mobile (wraps to new line), inline on md+ */}
                <div className="flex items-center gap-1.5 w-full md:w-auto pl-12 md:pl-0">
                  {user.status === "pending" && (
                    <>
                      <button
                        type="button"
                        disabled={approving.has(user.id) || rejecting.has(user.id)}
                        onClick={() => handleApprove(user.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-1"
                      >
                        {approving.has(user.id) ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : null}
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={approving.has(user.id) || rejecting.has(user.id)}
                        onClick={() => handleReject(user.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-700 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-1"
                      >
                        {rejecting.has(user.id) ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : null}
                        Reject
                      </button>
                    </>
                  )}

                  {user.status === "active" && user.id !== currentUserId && (
                    <button
                      type="button"
                      disabled={promoting.has(user.id)}
                      onClick={() =>
                        user.isAdmin ? handleDemote(user.id) : handlePromote(user.id)
                      }
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-secondary-300 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-secondary-600 transition-colors flex items-center gap-1"
                    >
                      {promoting.has(user.id) ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : user.isAdmin ? (
                        <ShieldOff size={11} />
                      ) : (
                        <Shield size={11} />
                      )}
                      {user.isAdmin ? "Demote" : "Promote"}
                    </button>
                  )}

                  {user.status === "active" && user.id !== currentUserId && (
                    <button
                      type="button"
                      disabled={togglingMentor.has(user.id)}
                      onClick={() =>
                        user.isMentor ? handleRevokeMentor(user.id) : handleGrantMentor(user.id)
                      }
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-secondary-300 hover:bg-primary-50 hover:text-primary-800 disabled:opacity-50 disabled:cursor-not-allowed text-secondary-600 transition-colors flex items-center gap-1"
                    >
                      {togglingMentor.has(user.id) ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <GraduationCap size={11} />
                      )}
                      {user.isMentor ? "Unmentor" : "Mentor"}
                    </button>
                  )}

                  {(user.status === "active" || user.status === "rejected") &&
                    user.id !== currentUserId && (
                      <button
                        type="button"
                        disabled={deleting.has(user.id)}
                        onClick={() => handleDelete(user.id)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-secondary-300 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-secondary-600 transition-colors flex items-center gap-1"
                      >
                        {deleting.has(user.id) ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : null}
                        Delete
                      </button>
                    )}

                  {user.status !== "active" && (
                    <button
                      type="button"
                      onClick={() => {
                        if (mergingUserId === user.id) setMergingUserId(null);
                        else {
                          setMergingUserId(user.id);
                          setMergeTargetId("");
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface border border-secondary-300 hover:bg-secondary-50 text-secondary-700 transition-colors"
                    >
                      {mergingUserId === user.id ? "Cancel" : "Merge"}
                    </button>
                  )}
                </div>
              </div>

              {/* Merge panel */}
              {mergingUserId === user.id && (
                <div className="px-4 py-3 border-t border-secondary-200 flex items-center gap-3">
                  <p className="text-xs text-secondary-600 shrink-0">Merge into:</p>
                  <select
                    value={mergeTargetId}
                    onChange={(e) => setMergeTargetId(e.target.value)}
                    className="flex-1 rounded-lg bg-surface border border-secondary-300 px-3 py-1.5 text-sm text-secondary-900 focus:outline-none focus:border-primary-500"
                  >
                    <option value="">Select a user…</option>
                    {users
                      .filter((u) => {
                        if (u.id === user.id) return false;
                        const sourceProviders = new Set(user.identities.map((i) => i.provider));
                        return !u.identities.some((i) => sourceProviders.has(i.provider));
                      })
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName} — {u.email} ({u.status})
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    disabled={!mergeTargetId || mergeLoading}
                    onClick={() => handleMerge(user.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-1.5 shrink-0"
                  >
                    {mergeLoading && <Loader2 size={11} className="animate-spin" />}
                    Confirm merge
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
