import { site } from "@g3/site-config";
import { OnShapeIcon } from "@g3/ui";
import { Loader2, Shield } from "lucide-react";
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
  onshape: "OnShape",
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

  async function handleUnlink(identityId: string, provider: string) {
    if (!me || me.identities.length <= 1) {
      alert("You must keep at least one sign-in method linked.");
      return;
    }

    const confirmed = window.confirm(
      `Unlink ${PROVIDER_LABELS[provider] ?? provider}? You'll no longer be able to sign in with this method.`,
    );
    if (!confirmed) return;

    setUnlinkingProvider(identityId);
    try {
      const res = await api.auth.identities[":identityId"].$delete({
        param: { identityId },
      });
      if (!res.ok) {
        alert("Failed to unlink account");
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
      alert("Failed to unlink account");
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
      <main className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-primary-500">{error}</p>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex-1 flex items-center justify-center px-4">
        <Loader2 size={24} className="animate-spin text-secondary-500" />
      </main>
    );
  }

  return (
    <main className="flex-1 px-6 py-8 max-w-lg mx-auto w-full">
      <h1 className="text-5xl font-bold text-secondary-900 mb-4 text-center">Dashboard</h1>

      <div className="bg-surface border border-secondary-200 rounded-lg divide-y divide-secondary-100 mt-4">
        <div className="px-5 py-4 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary-500 flex items-center justify-center text-lg font-semibold text-white shrink-0">
            {me.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-secondary-900 font-semibold truncate">{me.displayName}</p>
            <p className="text-secondary-600 text-sm truncate">{me.email}</p>
          </div>
          <span className="ml-auto text-xs px-2.5 py-0.5 rounded-full border capitalize bg-green-50 text-green-700 border-green-200 shrink-0">
            {me.status}
          </span>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs text-secondary-500 uppercase tracking-wide mb-3">Linked Accounts</p>
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

              return (
                <div
                  key={identity.provider}
                  className="flex items-center justify-between text-sm group"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-secondary-900">
                        {PROVIDER_LABELS[identity.provider] ?? identity.provider}
                      </p>
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
                  <div className="ml-2 flex items-center gap-2 shrink-0">
                    {(identity.provider === "steam" ||
                      identity.provider === "google" ||
                      identity.provider === "github") && (
                      <a
                        href={`${import.meta.env.VITE_API_BASE_URL}/auth/${identity.provider}/link`}
                        className="px-2 py-1 rounded bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold transition-colors cursor-pointer"
                        title={`Add another ${identity.provider} account`}
                      >
                        +
                      </a>
                    )}
                    {identity.provider !== "slack" && (
                      <button
                        type="button"
                        onClick={() => handleUnlink(identity.id, identity.provider)}
                        disabled={unlinkingProvider === identity.id}
                        className="px-2 py-1 rounded bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-xs text-white transition-colors cursor-pointer"
                      >
                        {unlinkingProvider === identity.id ? "Unlinking…" : "Unlink"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 space-y-2">
            {!me.identities.some((i) => i.provider === "google") && (
              <a
                href={`${import.meta.env.VITE_API_BASE_URL}/auth/google/link`}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-700 px-4 py-2 text-sm text-white transition-colors"
              >
                <FaGoogle size={16} />
                Connect Google
              </a>
            )}
            {!me.identities.some((i) => i.provider === "github") && (
              <a
                href={`${import.meta.env.VITE_API_BASE_URL}/auth/github/link`}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-700 px-4 py-2 text-sm text-white transition-colors"
              >
                <FaGithub size={16} />
                Connect GitHub
              </a>
            )}
            {!me.identities.some((i) => i.provider === "steam") && (
              <a
                href={`${import.meta.env.VITE_API_BASE_URL}/auth/steam/link`}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-700 px-4 py-2 text-sm text-white transition-colors"
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
                  <div className="flex items-center justify-center gap-1.5 text-xs text-secondary-500">
                    <Loader2 size={12} className="animate-spin" />
                    Waiting…
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleConnectSlack}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-700 px-4 py-2 text-sm text-white transition-colors cursor-pointer"
                  >
                    <FaSlack size={16} />
                    Connect Slack
                  </button>
                  {slackError && (
                    <p className="mt-1 text-xs text-primary-500 text-center">{slackError}</p>
                  )}
                </>
              )}
            </div>
          )}
          {me.sessionType === "oauth" && !me.identities.some((i) => i.provider === "onshape") && (
            <a
              href={`${import.meta.env.VITE_API_BASE_URL}/auth/onshape`}
              className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 hover:bg-primary-700 px-4 py-2 text-sm text-white transition-colors"
            >
              <OnShapeIcon size={16} white />
              Connect OnShape
            </a>
          )}
        </div>

        {me.sessionType === "oauth" && (
          <div className="px-5 py-4">
            <p className="text-xs text-secondary-500 uppercase tracking-wide mb-3">Kiosk PIN</p>
            {pin && showPin ? (
              <div className="bg-surface border border-secondary-300 rounded-lg p-3 text-center">
                <p className="text-2xl font-mono font-bold text-secondary-900 tracking-widest">
                  {pin}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={fetchPin}
                disabled={pinLoading}
                className="w-full px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-sm text-white transition-colors"
              >
                {pinLoading ? "Loading..." : "View PIN"}
              </button>
            )}
            {pinError && !pin && (
              <p className="text-xs text-primary-500 text-center mt-2">{pinError}</p>
            )}
          </div>
        )}

        <div className="px-5 py-4 flex items-center justify-between">
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
      </div>
    </main>
  );
}
