import {
  Badge,
  Button,
  Chip,
  ConfirmQuestion,
  ErrorBanner,
  Loading,
  Page,
  TextField,
  inputClass,
  redirectToSignIn,
} from "@g3/ui";
import { GraduationCap, Search, Shield, ShieldOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { g3id as api } from "../../lib/api";
import {
  PROVIDERS,
  ProviderIcon,
  STATUS_STYLES,
  type User,
  matchesSearch,
  otherUsername,
  relativeTime,
} from "./members-shared";

const FILTERS = ["pending", "active", "rejected", "all"] as const;
type Filter = (typeof FILTERS)[number];

/** The orders the list can be put in. Someone who has never logged in is always last. */
const SORTS = {
  "joined-new": { label: "Joined: newest first", by: "joined", descending: true },
  "joined-old": { label: "Joined: oldest first", by: "joined", descending: false },
  "name-az": { label: "Name: A to Z", by: "name", descending: false },
  "name-za": { label: "Name: Z to A", by: "name", descending: true },
  "login-new": { label: "Last sign-in: most recent first", by: "login", descending: true },
  "login-old": { label: "Last sign-in: longest ago first", by: "login", descending: false },
} as const;
type Sort = keyof typeof SORTS;

const ROLES = {
  admin: { label: "Admins", has: (u: User) => u.isAdmin === 1 },
  mentor: { label: "Mentors", has: (u: User) => u.isMentor === 1 },
  none: { label: "Neither", has: (u: User) => u.isAdmin !== 1 && u.isMentor !== 1 },
} as const;
type Role = keyof typeof ROLES;

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

const selectClass = `${inputClass} !w-auto`;

const isFilter = (v: string | null): v is Filter => FILTERS.includes(v as Filter);
const isSort = (v: string | null): v is Sort => v !== null && v in SORTS;
const isRole = (v: string | null): v is Role => v !== null && v in ROLES;

export function MembersPage() {
  const navigate = useNavigate();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  // The tab, search, sort and filters live in the address, so coming back from someone's page
  // finds the list as it was. Active people first.
  const [params, setParams] = useSearchParams();
  const status = params.get("status");
  const filter: Filter = isFilter(status) ? status : "active";
  const sortParam = params.get("sort");
  const sort: Sort = isSort(sortParam) ? sortParam : "joined-new";
  const roleParam = params.get("role");
  const role: Role | "" = isRole(roleParam) ? roleParam : "";
  const provider = params.get("signin") ?? "";
  const query = params.get("q") ?? "";
  const setParam = (key: string, value: string, fallback = "") =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const setFilter = (f: Filter) => setParam("status", f, "active");
  const setSort = (s: Sort) => setParam("sort", s, "joined-new");
  const setRole = (r: Role | "") => setParam("role", r);
  const setProvider = (p: string) => setParam("signin", p);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [approving, setApproving] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<Set<string>>(new Set());
  const [togglingMentor, setTogglingMentor] = useState<Set<string>>(new Set());
  const [mergingUserId, setMergingUserId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeLoading, setMergeLoading] = useState(false);

  useEffect(() => {
    api.auth.me.$get().then(async (res) => {
      if (res.status === 401) {
        redirectToSignIn();
        return;
      }
      const data = (await res.json()) as { id: string; isAdmin?: boolean };
      if (!res.ok || !data.isAdmin) {
        navigate("/");
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

  /** The user whose Delete was pressed: asked about under their row first. */
  const [askingDelete, setAskingDelete] = useState<string | null>(null);

  async function handleDelete(userId: string) {
    setAskingDelete(null);
    setDeleting((prev) => new Set(prev).add(userId));
    setActionError(null);
    try {
      const res = await api.admin.users[":id"].$delete({ param: { id: userId } });
      if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== userId));
      else {
        // Say so: a delete that failed used to look like nothing had happened.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError((res.status < 500 && body.error) || "Couldn't delete the user.");
      }
    } catch {
      setActionError("Couldn't delete the user.");
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

  // The search, role and sign-in filters narrow every tab, so each tab's count is of what it would show.
  const matching = useMemo(
    () =>
      users.filter(
        (u) =>
          (role === "" || ROLES[role].has(u)) &&
          (provider === "" || u.identities.some((identity) => identity.provider === provider)) &&
          matchesSearch(u, query),
      ),
    [users, role, provider, query],
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

    const authMethods = ["Slack", "Discord", "Google", "GitHub", "Steam"];
    const headers = [
      "Name",
      "Username",
      "Email",
      "Joined Date",
      "Last Sign-in",
      "Admin",
      "Mentor",
      ...authMethods,
    ];

    const rows = activeUsers.map((u) => {
      const providerSet = new Set(u.identities.map((i) => i.provider));
      const authValues = {
        slack: providerSet.has("slack"),
        discord: providerSet.has("discord"),
        google: providerSet.has("google"),
        github: providerSet.has("github"),
        steam: providerSet.has("steam"),
      };
      return [
        u.displayName,
        u.username ?? "",
        u.email,
        new Date(u.createdAt * 1000).toLocaleDateString(),
        u.lastLoginAt ? new Date(u.lastLoginAt * 1000).toLocaleString() : "Never",
        u.isAdmin ? "TRUE" : "FALSE",
        u.isMentor ? "TRUE" : "FALSE",
        authValues.slack ? "TRUE" : "FALSE",
        authValues.discord ? "TRUE" : "FALSE",
        authValues.google ? "TRUE" : "FALSE",
        authValues.github ? "TRUE" : "FALSE",
        authValues.steam ? "TRUE" : "FALSE",
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
    <Page
      title="Members"
      width="narrow"
      actions={<Button onClick={exportActiveUsersToCSV}>Export active users (CSV)</Button>}
    >
      <div className="space-y-3">
        {/* Search: names, emails and the accounts people sign in with */}
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary-400"
          />
          <TextField
            type="search"
            value={query}
            onChange={(e) => setParam("q", e.target.value)}
            placeholder="Search by name, email or sign-in account"
            aria-label="Search users"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
              <span className="capitalize">{f}</span>{" "}
              <span className="opacity-60">({countFor(f)})</span>
              {f === "pending" && filter !== "pending" && countFor(f) > 0 && (
                <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />
              )}
            </Chip>
          ))}
        </div>

        {/* Sort, and filter by role and sign-in */}
        <div className="flex flex-wrap gap-2">
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
      </div>

      {loading && <Loading />}
      {error && <ErrorBanner message={error} />}
      {actionError && <ErrorBanner message={actionError} />}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-secondary-500 text-center py-16">
          {role || provider || query
            ? "No users match."
            : `No ${filter === "all" ? "" : `${filter} `}users.`}
        </p>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {filtered.map((user) => (
            <div
              key={user.id}
              className="bg-surface border border-secondary-200 rounded-xl overflow-hidden"
            >
              {/* Main row */}
              <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
                {/* Avatar, name and identity icons: open the person's page */}
                <Link
                  to={`/admin/members/${user.id}`}
                  state={{ from: `/admin/members${params.toString() ? `?${params}` : ""}` }}
                  className="flex flex-1 min-w-0 items-center gap-3 rounded-md group"
                >
                  <div className="w-9 h-9 rounded-full bg-primary-500 flex items-center justify-center text-sm font-semibold text-on-primary shrink-0">
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-secondary-900 font-semibold group-hover:text-primary-600 group-hover:underline">
                        {user.displayName}
                      </span>
                      {otherUsername(user) && (
                        <span className="text-sm text-secondary-500" title="Username">
                          {otherUsername(user)}
                        </span>
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
                      {STATUS_STYLES[user.status] && (
                        <Badge colors={STATUS_STYLES[user.status]}>
                          <span className="capitalize">{user.status}</span>
                        </Badge>
                      )}
                    </div>
                    {/* Identity icons + timestamps */}
                    <div className="flex items-center gap-2 mt-1">
                      {user.identities.map((identity) => (
                        <ProviderIcon key={identity.provider} provider={identity.provider} />
                      ))}
                      <span className="text-xs text-secondary-500">·</span>
                      <span className="text-xs text-secondary-500" title="Last sign-in">
                        {user.lastLoginAt ? relativeTime(user.lastLoginAt) : "never signed in"}
                      </span>
                      <span className="text-xs text-secondary-500">·</span>
                      <span className="text-xs text-secondary-500" title="Joined">
                        joined {relativeTime(user.createdAt)}
                      </span>
                    </div>
                  </div>
                </Link>

                {/* Action buttons: a line of their own on a phone, beside the name on wider screens */}
                <div className="flex flex-wrap items-center gap-1.5 w-full md:w-auto pl-12 md:pl-0">
                  {user.status === "pending" && (
                    <>
                      <Button
                        size="sm"
                        disabled={approving.has(user.id) || rejecting.has(user.id)}
                        onClick={() => handleApprove(user.id)}
                      >
                        {approving.has(user.id) ? "Approving…" : "Approve"}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={approving.has(user.id) || rejecting.has(user.id)}
                        onClick={() => handleReject(user.id)}
                      >
                        {rejecting.has(user.id) ? "Rejecting…" : "Reject"}
                      </Button>
                    </>
                  )}

                  {user.status === "active" && user.id !== currentUserId && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={promoting.has(user.id)}
                      onClick={() =>
                        user.isAdmin ? handleDemote(user.id) : handlePromote(user.id)
                      }
                    >
                      {user.isAdmin ? <ShieldOff size={14} /> : <Shield size={14} />}
                      {user.isAdmin ? "Demote" : "Promote"}
                    </Button>
                  )}

                  {/* Your own mentor role is yours to change too. */}
                  {user.status === "active" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={togglingMentor.has(user.id)}
                      onClick={() =>
                        user.isMentor ? handleRevokeMentor(user.id) : handleGrantMentor(user.id)
                      }
                    >
                      <GraduationCap size={14} />
                      {user.isMentor ? "Unmentor" : "Mentor"}
                    </Button>
                  )}

                  {(user.status === "active" || user.status === "rejected") &&
                    user.id !== currentUserId && (
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deleting.has(user.id)}
                        onClick={() => setAskingDelete(askingDelete === user.id ? null : user.id)}
                      >
                        {deleting.has(user.id) ? "Deleting…" : "Delete"}
                      </Button>
                    )}

                  {user.status !== "active" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        if (mergingUserId === user.id) setMergingUserId(null);
                        else {
                          setMergingUserId(user.id);
                          setMergeTargetId("");
                        }
                      }}
                    >
                      {mergingUserId === user.id ? "Cancel" : "Merge"}
                    </Button>
                  )}
                </div>
              </div>

              {askingDelete === user.id && (
                <div className="px-4 py-3 border-t border-secondary-200">
                  <ConfirmQuestion
                    size="sm"
                    question={`Permanently delete ${user.displayName} and all their data?`}
                    confirmLabel="Delete"
                    onConfirm={() => void handleDelete(user.id)}
                    onKeep={() => setAskingDelete(null)}
                  />
                </div>
              )}

              {/* Merge panel */}
              {mergingUserId === user.id && (
                <div className="px-4 py-3 border-t border-secondary-200 flex flex-wrap items-center gap-3">
                  <p className="text-xs text-secondary-600 shrink-0">Merge into:</p>
                  <select
                    value={mergeTargetId}
                    onChange={(e) => setMergeTargetId(e.target.value)}
                    className={`${inputClass} min-w-48 flex-1`}
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
                  <Button
                    disabled={!mergeTargetId || mergeLoading}
                    onClick={() => handleMerge(user.id)}
                  >
                    {mergeLoading ? "Merging…" : "Confirm merge"}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
