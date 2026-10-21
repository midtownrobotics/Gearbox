import { appUrl, site } from "@g3/site-config";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorBanner,
  Loading,
  Page,
  buttonClass,
  redirectToSignIn,
  tones,
} from "@g3/ui";
import { Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FaDiscord, FaGithub, FaGoogle, FaSlack, FaSteam } from "react-icons/fa";
import { Link } from "react-router-dom";
import { g3id as api } from "../../lib/api";

type Identity = {
  id: string;
  provider: string;
  createdAt: number;
  providerEmail?: string | null;
  providerId?: string;
};

type Me = {
  id: string;
  email: string;
  displayName: string;
  /** The name on the chat account they joined with (Slack or Discord). */
  username?: string | null;
  status: string;
  isAdmin: boolean;
  createdAt: number;
  identities: Identity[];
  sessionType: "oauth" | "pin";
  kioskDeviceId?: number;
};

/**
 * Linking another sign-in starts on ID's own address, as signing in does: the provider sends them
 * back there, and ID back to this page.
 */
const linkUrl = (provider: string) => `${appUrl("id")}/api/auth/${provider}/link`;

const PROVIDER_LABELS: Record<string, string> = {
  local: "Password",
  google: "Google",
  slack: "Slack",
  discord: "Discord",
  github: "GitHub",
  steam: "Steam",
};

/** The services a member can link more than one account of, in the order their buttons show. */
const MULTI_ACCOUNT = [
  { provider: "google", Icon: FaGoogle },
  { provider: "github", Icon: FaGithub },
  { provider: "steam", Icon: FaSteam },
];

const isChat = (provider: string) => provider === "slack" || provider === "discord";

/**
 * Their sign-ins in the order the page lists them: the team's chat first (the account they joined
 * with ahead of any linked later), then the rest, oldest first.
 */
function inOrder(identities: Identity[]): Identity[] {
  return [...identities].sort(
    (a, b) => Number(isChat(b.provider)) - Number(isChat(a.provider)) || a.createdAt - b.createdAt,
  );
}

/**
 * The account name a sign-in was linked with, so two of the same service can be told apart, and
 * a link to its profile where the service has one. The chat account they joined with shows their
 * username.
 */
function accountName(
  identity: Identity,
  me: Me,
  joinedWith: string | undefined,
): { text: string; url?: string } | null {
  if (identity.id === joinedWith && me.username) return { text: me.username };
  if (identity.provider === "local") return { text: me.email };
  if (identity.provider === "steam") {
    const id = identity.providerEmail || identity.providerId;
    return id ? { text: id, url: `https://steamcommunity.com/profiles/${id}` } : null;
  }
  const name = identity.providerEmail;
  if (!name) return null;
  // A GitHub account's is its email; only a username has a profile to link to.
  if (identity.provider === "github" && !name.includes("@")) {
    return { text: name, url: `https://github.com/${name}` };
  }
  return { text: name };
}

/** A member's status as a badge's colors: only one that needs noticing (active shows none). */
const STATUS_TONES: Partial<Record<string, string>> = {
  pending: tones.warning,
  rejected: tones.danger,
};

/** The signed-in member's account: their sign-ins, kiosk PIN, and signing out. */
export function AccountPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [slackCode, setSlackCode] = useState<string | null>(null);
  const [slackError, setSlackError] = useState<string | null>(null);
  const slackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [pin, setPin] = useState<string | null>(null);
  const [showPin, setShowPin] = useState(false);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);
  /** Why unlinking a sign-in didn't work. */
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  /** The ways the team signs in; a method it switched off can't be linked. */
  const [methods, setMethods] = useState<Partial<Record<string, boolean>>>({});
  useEffect(() => {
    api.team["sign-in"]
      .$get()
      .then((res) => (res.ok ? res.json() : {}))
      .then(setMethods)
      .catch(() => {});
  }, []);
  const linkable = (provider: string) => methods[provider] !== false;

  async function handleConnectSlack() {
    setSlackError(null);
    const res = await api.auth.slack.link.$get();
    if (!res.ok) {
      setSlackError("Failed to start linking. Try again.");
      return;
    }
    const data = (await res.json()) as { code: string; token: string };
    setSlackCode(data.code);

    slackPollRef.current = setInterval(async () => {
      try {
        const res = await api.auth.slack.status.$get({ query: { token: data.token } });
        if (!res.ok) return;
        const status = (await res.json()) as {
          status: string;
          action?: string;
          message?: string;
        };
        if (status.status === "pending") return;
        if (slackPollRef.current) clearInterval(slackPollRef.current);
        if (status.status === "success" && status.action === "linked") {
          setSlackCode(null);
          void loadMe();
        } else {
          setSlackError(
            status.status === "expired"
              ? "Code expired. Please try again."
              : (status.message ?? "Something went wrong."),
          );
          setSlackCode(null);
        }
      } catch {
        // network error — keep polling
      }
    }, 2000);
  }

  useEffect(
    () => () => {
      if (slackPollRef.current) clearInterval(slackPollRef.current);
    },
    [],
  );

  async function handleLogout() {
    const res = await api.auth.logout.$post();
    const data = (await res.json()) as { isKiosk?: boolean };
    // A kiosk goes back to its PIN pad; anyone else to the team's front door.
    window.location.assign(data.isKiosk ? `${appUrl("id")}/kiosk/login` : "/");
  }

  async function fetchPin() {
    setPinError(null);
    setPinLoading(true);
    try {
      const res = await api.auth.pin.me.$get();
      if (res.status === 404) {
        // No PIN exists yet, generate one
        const genRes = await api.auth.pin.regenerate.$post();
        if (!genRes.ok) {
          setPinError("Failed to generate PIN");
          return;
        }
        const data = (await genRes.json()) as { pin: string };
        setPin(data.pin);
        setShowPin(true);
        return;
      }
      if (!res.ok) {
        setPinError("Failed to load PIN");
        return;
      }
      const data = (await res.json()) as { pin: string };
      setPin(data.pin);
      setShowPin(true);
    } catch {
      setPinError("Failed to load PIN");
    } finally {
      setPinLoading(false);
    }
  }

  async function handleUnlink(identityId: string) {
    if (!me || me.identities.length <= 1) {
      setUnlinkError("You must keep at least one sign-in method linked.");
      return;
    }

    setUnlinkError(null);
    setUnlinkingProvider(identityId);
    try {
      const res = await api.auth.identities[":identityId"].$delete({
        param: { identityId },
      });
      if (!res.ok) {
        setUnlinkError("Couldn't unlink that account. Try again.");
        return;
      }
      setMe((prev) =>
        prev
          ? {
              ...prev,
              identities: prev.identities.filter((i) => i.id !== identityId),
            }
          : prev,
      );
    } catch {
      setUnlinkError("Couldn't unlink that account. Check your connection and try again.");
    } finally {
      setUnlinkingProvider(null);
    }
  }

  async function loadMe() {
    const res = await api.auth.me.$get();
    if (res.status === 401) {
      redirectToSignIn();
      return;
    }
    if (res.status === 404) {
      window.location.assign(`${appUrl("id")}/signup`);
      return;
    }
    if (!res.ok) {
      setError("Failed to load your account.");
      return;
    }
    setMe((await res.json()) as Me);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once
  useEffect(() => {
    void loadMe();
  }, []);

  if (error) {
    return (
      <Page title="Account" width="narrow">
        <ErrorBanner message={error} />
      </Page>
    );
  }

  if (!me) {
    return (
      <Page title="Account" width="narrow">
        <Loading />
      </Page>
    );
  }

  const identities = inOrder(me.identities);
  const joinedWith = identities.find((i) => isChat(i.provider))?.id;

  return (
    <Page title="Account" width="narrow">
      <Card className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-primary-500 flex items-center justify-center text-lg font-semibold text-on-primary shrink-0">
          {me.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-secondary-900 font-semibold truncate">{me.displayName}</p>
          <p className="text-secondary-600 text-sm truncate">{me.email}</p>
        </div>
        {STATUS_TONES[me.status] && (
          <Badge colors={STATUS_TONES[me.status]}>
            <span className="capitalize">{me.status}</span>
          </Badge>
        )}
      </Card>

      <Card title="Linked accounts">
        {unlinkError && (
          <div className="mb-3">
            <ErrorBanner message={unlinkError} />
          </div>
        )}
        <div className="space-y-2">
          {identities.map((identity) => {
            const name = accountName(identity, me, joinedWith);
            const label = PROVIDER_LABELS[identity.provider] ?? identity.provider;

            return (
              <div
                key={identity.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="text-secondary-900 shrink-0">{label}</p>
                    {name &&
                      (name.url ? (
                        <a
                          href={name.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-500 hover:text-primary-600 truncate"
                        >
                          {name.text}
                        </a>
                      ) : (
                        <span className="text-secondary-600 truncate">{name.text}</span>
                      ))}
                  </div>
                  <p className="text-secondary-500 text-xs">
                    Added {new Date(identity.createdAt * 1000).toLocaleDateString()}
                  </p>
                </div>
                {/* The team's chat stays linked: members join through it. */}
                {identity.provider !== "slack" &&
                  identity.provider !== "discord" &&
                  me.identities.length > 1 && (
                    <ConfirmButton
                      size="sm"
                      label={unlinkingProvider === identity.id ? "Unlinking…" : "Unlink"}
                      confirmLabel="Unlink"
                      question={`Unlink ${label}? You won't be able to sign in with it.`}
                      disabled={unlinkingProvider === identity.id}
                      onConfirm={() => void handleUnlink(identity.id)}
                    />
                  )}
              </div>
            );
          })}
        </div>

        {/* One button per service: Connect it, or add another account of it once one is linked. */}
        <div className="mt-3 space-y-2">
          {MULTI_ACCOUNT.filter(({ provider }) => linkable(provider)).map(({ provider, Icon }) => {
            const linked = me.identities.some((i) => i.provider === provider);
            return (
              <a
                key={provider}
                href={linkUrl(provider)}
                className={`${buttonClass(linked ? "secondary" : "primary")} w-full`}
              >
                <Icon size={16} />
                {linked
                  ? `Add another ${PROVIDER_LABELS[provider]} account`
                  : `Connect ${PROVIDER_LABELS[provider]}`}
              </a>
            );
          })}
        </div>
        {methods.discord === true && !me.identities.some((i) => i.provider === "discord") && (
          <a href={linkUrl("discord")} className={`${buttonClass()} mt-3 w-full`}>
            <FaDiscord size={16} />
            Connect Discord
          </a>
        )}
        {methods.slack !== false && !me.identities.some((i) => i.provider === "slack") && (
          <div className="mt-3">
            {slackCode ? (
              <div className="rounded-lg bg-secondary-50 border border-secondary-200 px-4 py-3 space-y-2">
                <p className="text-xs text-secondary-600 text-center">
                  DM this code to the {""}
                  <span className="text-primary-500 font-medium">
                    "{site.slackBotName}" user in Slack
                  </span>
                  , or run <span className="font-mono text-primary-500">/link {slackCode}</span>
                </p>
                <p className="font-mono text-3xl font-bold text-secondary-900 text-center tracking-widest">
                  {slackCode}
                </p>
                <p className="text-center text-xs text-secondary-500">Waiting…</p>
              </div>
            ) : (
              <>
                <Button className="w-full" onClick={handleConnectSlack}>
                  <FaSlack size={16} />
                  Connect Slack
                </Button>
                {slackError && (
                  <p className="mt-1 text-xs text-red-700 text-center">{slackError}</p>
                )}
              </>
            )}
          </div>
        )}
      </Card>

      {me.sessionType === "oauth" && (
        <Card title="Kiosk PIN">
          {pin && showPin ? (
            <p className="rounded-lg border border-secondary-300 p-3 text-center text-2xl font-mono font-bold text-secondary-900 tracking-widest">
              {pin}
            </p>
          ) : (
            <Button className="w-full" disabled={pinLoading} onClick={fetchPin}>
              {pinLoading ? "Loading…" : "View PIN"}
            </Button>
          )}
          {pinError && !pin && <p className="text-xs text-red-700 text-center mt-2">{pinError}</p>}
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-secondary-500">
          Member since {new Date(me.createdAt * 1000).toLocaleDateString()}
        </p>
        <div className="flex items-center gap-3">
          {me.isAdmin ? (
            <Link
              to="/admin/members"
              className="text-xs text-primary-500 hover:text-primary-600 transition-colors flex items-center gap-1"
            >
              <Shield size={12} /> Admin
            </Link>
          ) : null}
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs text-secondary-500 hover:text-primary-600 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </Page>
  );
}
