import { site } from "@g3/site-config";
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorBanner,
  Loading,
  Page,
  buttonClass,
  tones,
} from "@g3/ui";
import { Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FaGithub, FaGoogle, FaSlack, FaSteam } from "react-icons/fa";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";

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
  status: string;
  isAdmin: boolean;
  createdAt: number;
  identities: Identity[];
  sessionType: "oauth" | "pin";
  kioskDeviceId?: number;
};

const PROVIDER_LABELS: Record<string, string> = {
  local: "Password",
  google: "Google",
  slack: "Slack",
  github: "GitHub",
  steam: "Steam",
};

/** A member's status as a badge's colors. */
const STATUS_TONES: Record<string, string> = {
  active: tones.success,
  pending: tones.warning,
  rejected: tones.danger,
};

export function DashboardPage() {
  const navigate = useNavigate();
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
          setMe((prev) =>
            prev
              ? {
                  ...prev,
                  identities: [
                    ...prev.identities,
                    {
                      id: `slack-${Date.now()}`,
                      provider: "slack",
                      createdAt: Math.floor(Date.now() / 1000),
                    },
                  ],
                }
              : prev,
          );
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
    if (data.isKiosk) {
      navigate("/kiosk/login");
    } else {
      navigate("/login");
    }
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

  useEffect(() => {
    api.auth.me.$get().then(async (res) => {
      if (res.status === 401) {
        navigate("/login");
        return;
      }
      if (res.status === 404) {
        navigate("/signup");
        return;
      }
      if (!res.ok) {
        setError("Failed to load your account.");
        return;
      }
      const data = (await res.json()) as Me;
      setMe(data);
    });
  }, [navigate]);

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
        <Badge colors={STATUS_TONES[me.status] ?? tones.neutral}>
          <span className="capitalize">{me.status}</span>
        </Badge>
      </Card>

      {me.isAdmin && me.sessionType !== "pin" && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-primary-200">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 shrink-0 text-primary-600" />
            <div>
              <h2 className="text-xl text-secondary-900">Admin</h2>
              <p className="text-sm text-secondary-600">
                Manage trusted students and app permissions.
              </p>
            </div>
          </div>
          <Link to="/admin" className={buttonClass("primary")}>
            Manage permissions
          </Link>
        </Card>
      )}

      <Card title="Linked accounts">
        {unlinkError && (
          <div className="mb-3">
            <ErrorBanner message={unlinkError} />
          </div>
        )}
        <div className="space-y-2">
          {me.identities.map((identity) => {
            let displayText: string | null = null;
            let profileUrl: string | null = null;

            if (identity.provider === "github" && identity.providerEmail) {
              displayText = identity.providerEmail;
              profileUrl = `https://github.com/${identity.providerEmail}`;
            } else if (
              identity.provider === "steam" &&
              (identity.providerEmail || identity.providerId)
            ) {
              displayText = (identity.providerEmail || identity.providerId) ?? null;
              if (displayText) {
                profileUrl = `https://steamcommunity.com/profiles/${displayText}`;
              }
            } else if (identity.provider === "google" && identity.providerEmail) {
              displayText = identity.providerEmail;
            }
            const label = PROVIDER_LABELS[identity.provider] ?? identity.provider;

            return (
              <div
                key={identity.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-secondary-900">{label}</p>
                    {displayText &&
                      (profileUrl ? (
                        <a
                          href={profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-500 hover:text-primary-600 text-xs truncate"
                        >
                          {displayText}
                        </a>
                      ) : (
                        <span className="text-secondary-400 text-xs truncate">{displayText}</span>
                      ))}
                  </div>
                  <p className="text-secondary-500 text-xs">
                    Added {new Date(identity.createdAt * 1000).toLocaleDateString()}
                  </p>
                </div>
                {(identity.provider === "steam" ||
                  identity.provider === "google" ||
                  identity.provider === "github") &&
                  linkable(identity.provider) && (
                    <a
                      href={`${import.meta.env.VITE_API_BASE_URL}/auth/${identity.provider}/link`}
                      className={`${buttonClass("secondary", "sm")} ml-auto`}
                    >
                      Add another
                    </a>
                  )}
                {identity.provider !== "slack" && me.identities.length > 1 && (
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

        <div className="mt-3 space-y-2">
          {linkable("google") && !me.identities.some((i) => i.provider === "google") && (
            <a
              href={`${import.meta.env.VITE_API_BASE_URL}/auth/google/link`}
              className={`${buttonClass()} w-full`}
            >
              <FaGoogle size={16} />
              Connect Google
            </a>
          )}
          {linkable("github") && !me.identities.some((i) => i.provider === "github") && (
            <a
              href={`${import.meta.env.VITE_API_BASE_URL}/auth/github/link`}
              className={`${buttonClass()} w-full`}
            >
              <FaGithub size={16} />
              Connect GitHub
            </a>
          )}
          {linkable("steam") && !me.identities.some((i) => i.provider === "steam") && (
            <a
              href={`${import.meta.env.VITE_API_BASE_URL}/auth/steam/link`}
              className={`${buttonClass()} w-full`}
            >
              <FaSteam size={16} />
              Connect Steam
            </a>
          )}
        </div>
        {!me.identities.some((i) => i.provider === "slack") && (
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
              to="/admin/users"
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
