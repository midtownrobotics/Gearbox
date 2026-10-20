import { tones } from "@g3/ui";
import { FaDiscord, FaGithub, FaGoogle, FaKey, FaSlack, FaSteam } from "react-icons/fa";

// What the Users list and a member's page share.

export type Identity = {
  provider: string;
  /** The account's name at that service: an email or a username. */
  providerEmail: string | null;
  createdAt: number;
};

export type User = {
  id: string;
  email: string;
  /** Their full name, which an admin can change. */
  displayName: string;
  /** The name on the chat account they signed up with; nobody edits it. */
  username: string | null;
  /** 1 until someone who just signed up has entered their name. */
  needsName: number;
  status: string;
  isAdmin: number;
  isMentor: number;
  createdAt: number;
  lastLoginAt: number | null;
  identities: Identity[];
};

export function relativeTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

/**
 * A member's status as a badge's colors (`Badge` from @g3/ui). Only a status that needs noticing
 * has one: an active member, which nearly everyone is, shows none.
 */
export const STATUS_STYLES: Partial<Record<string, string>> = {
  pending: tones.warning,
  rejected: tones.danger,
};

export function ProviderIcon({ provider }: { provider: string }) {
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
    case "discord":
      return (
        <span className={`${cls} text-indigo-600`} title="Discord">
          <FaDiscord />
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
    default:
      return <span className="text-xs text-secondary-500">{provider}</span>;
  }
}

/** Sign-in providers by the name people know them by, in the order they're offered. */
export const PROVIDERS: Record<string, string> = {
  slack: "Slack",
  discord: "Discord",
  google: "Google",
  github: "GitHub",
  steam: "Steam",
  local: "Password",
};

/** Lowercase without accents, so "zoe" finds "Zoë". */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Whether a user matches a search: every word is somewhere in their name, username, email, or the
 * name of an account they sign in with (a Slack, Discord or GitHub username, a Google email).
 */
export function matchesSearch(user: User, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(
    [
      user.displayName,
      user.username ?? "",
      user.email,
      ...user.identities.map((i) => i.providerEmail ?? ""),
    ].join(" "),
  );
  return words.every((word) => text.includes(word));
}

/** Their username when it says something their name doesn't. */
export const otherUsername = (user: Pick<User, "displayName" | "username">) =>
  user.username && user.username !== user.displayName ? user.username : null;
