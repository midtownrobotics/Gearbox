import { apiPath, site } from "@g3/site-config";
import { type FormEvent, useEffect, useState } from "react";
import { chatName, useTeamChat } from "../session";
import { Button, buttonClass } from "./button";
import { Chip } from "./chip";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { ErrorBanner, SuccessBanner } from "./messages";
import { TextField } from "./text-field";
import { Toggle } from "./toggle";

// "Report a problem", from every app's bar (AppNavBar): a problem or an idea, sent to the
// platform's /team/reports, which posts it as a public issue on Gearbox's GitHub. It shows the
// member their reporter ID, which stands for them on the issue, and that it can be blocked. A
// member can choose to put their name on it too (`withName`), off by default.

type Kind = "problem" | "idea";

type Reporter = { id: string; blocked: boolean; blockReason: string | null };

/** The signed-in member's reporter ID, or null until it's known (or if it can't be). */
function useReporter() {
  const [reporter, setReporter] = useState<Reporter | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${apiPath("platform")}/team/reports/reporter`, { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<Reporter>) : null))
      .then((r) => live && r && setReporter(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return reporter;
}

export function ReportDialog({ version, onClose }: { version?: string; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>("problem");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [withName, setWithName] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ issueUrl: string | null } | null>(null);
  const chat = useTeamChat();
  const reporter = useReporter();

  async function send(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${apiPath("platform")}/team/reports`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title,
          message,
          withName,
          page: window.location.href,
          version,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        issueUrl?: string | null;
      };
      if (!res.ok) throw new Error(body.error ?? "Couldn't send it. Try again.");
      setSent({ issueUrl: body.issueUrl ?? null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send it. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <Dialog title="Thanks for the report" onClose={onClose} centered>
        <SuccessBanner
          message={
            chat
              ? `Sent. You'll get a ${chatName(chat)} message when it's fixed or closed.`
              : "Sent."
          }
        />
        <div className="flex flex-wrap justify-end gap-2">
          {sent.issueUrl && (
            <a
              href={sent.issueUrl}
              target="_blank"
              rel="noreferrer"
              className="self-center text-sm font-medium text-primary-700 hover:underline"
            >
              See it on GitHub
            </a>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Report a problem" onClose={onClose}>
      <form onSubmit={send} className="space-y-4">
        <div className="flex gap-2">
          <Chip selected={kind === "problem"} onClick={() => setKind("problem")}>
            Something's wrong
          </Chip>
          <Chip selected={kind === "idea"} onClick={() => setKind("idea")}>
            An idea
          </Chip>
        </div>
        <Field label="Title (optional)">
          <TextField
            kind="issue"
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              kind === "problem" ? "Approve button does nothing" : "Sort parts by vendor"
            }
          />
        </Field>
        <Field
          label={kind === "problem" ? "What happened?" : "What would help?"}
          hint="Reports are public on Gearbox's GitHub, with this page's address, your browser and your reporter ID. Leave out other people's names and anything private."
        >
          <TextField
            multiline
            kind="note"
            rows={5}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              kind === "problem"
                ? "What you did, what you expected, and what happened instead"
                : "What you'd like Gearbox to do"
            }
            required
          />
        </Field>
        <Toggle
          label="Put my name on it"
          description={
            withName
              ? "Your name will be public on the report, beside your reporter ID."
              : "Your name stays off the report: only your reporter ID is shown."
          }
          checked={withName}
          onChange={setWithName}
        />
        {reporter && (
          <p className="text-sm text-secondary-600">
            Your reporter ID is <span className="font-mono text-secondary-900">{reporter.id}</span>.
            Gearbox can block it for spam or misuse, and if it does, your team's admins are told
            it's you and why.
          </p>
        )}
        {reporter?.blocked && (
          <ErrorBanner message="Your reporter ID is blocked, so you can't send reports. Ask your team's admins." />
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={sending || message.trim().length < 10 || reporter?.blocked}
          >
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// Where nobody is signed in (ID's sign-in pages, a signed-out visitor), on the public demo and on
// pages that belong to no team, there's no reporter to send for, so "Report a problem" opens
// GitHub's own Problem or Idea form (`.github/ISSUE_TEMPLATE`) in a new tab instead, filled in
// with what they wrote here and the page, versions, browser and team. They send it there, on
// their own GitHub account: nothing goes through Gearbox. The fields are filled by their ids in
// the forms (GitHub fills text boxes from the address, not dropdowns); rename one in both places.

/** The apps as the forms' App field names them (Portal's wordmark is "Gearbox"). */
const FORM_APPS = [
  "Attendance",
  "Edge",
  "ID",
  "Inventory",
  "Orders",
  "Pit",
  "Schedule",
  "Scouting",
  "Shop",
  "Skill Tree",
];

/** The app a bar's wordmark is for ("G3 SKILL TREE" → "Skill Tree"), or "" for none. */
export function appOfWordmark(wordmark: string): string {
  const upper = wordmark.trim().toUpperCase();
  if (/(^|\s)GEARBOX$/.test(upper)) return "Portal";
  return FORM_APPS.find((app) => new RegExp(`(^|\\s)${app.toUpperCase()}$`).test(upper)) ?? "";
}

/** The forms' App version and Platform version from the bar's label (`versionLabel`). */
function versionFields(label?: string): Record<string, string> {
  const match = label?.match(/^.+ (\S+) · platform (\S+)$/);
  if (match) return { "app-version": match[1], "platform-version": match[2] };
  return label ? { "app-version": label } : {};
}

/**
 * GitHub's new-issue address for a form, with its title and fields filled in. The title is the
 * platform's (`issueTitle`): the app, then the given title or else the text's first line.
 */
export function gitHubIssueUrl(
  kind: Kind,
  app: string,
  title: string,
  fields: Record<string, string>,
): string {
  const first = (title.trim() || (fields.message ?? "").trim().split("\n")[0]).replace(/\s+/g, " ");
  const query = new URLSearchParams({
    template: kind === "idea" ? "idea.yml" : "problem.yml",
    title: `${app || "Gearbox"}${kind === "idea" ? " idea" : ""}: ${first.slice(0, 80)}`,
    ...(app ? { app } : {}),
    ...fields,
  });
  return `${site.sourceUrl}/issues/new?${query}`;
}

export function GitHubReportDialog({
  app,
  version,
  team,
  onClose,
}: {
  /** The app's name, as the forms' App field takes it ("Orders"). */
  app: string;
  version?: string;
  /** The team's number, when the page is a team's. */
  team?: number;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>("problem");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const ready = message.trim().length >= 10;
  const url = gitHubIssueUrl(kind, app, title, {
    message: message.trim(),
    page: `${window.location.origin}${window.location.pathname}`,
    ...versionFields(version),
    browser: navigator.userAgent.slice(0, 300),
    ...(team ? { team: String(team) } : {}),
  });

  // The boxes stay typeable on the demo: what's written only leaves in the link the visitor opens
  // themselves, to GitHub, never through Gearbox.
  return (
    <Dialog title="Report a problem" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-2">
          <Chip selected={kind === "problem"} onClick={() => setKind("problem")}>
            Something's wrong
          </Chip>
          <Chip selected={kind === "idea"} onClick={() => setKind("idea")}>
            An idea
          </Chip>
        </div>
        <Field label="Title (optional)">
          <TextField
            typeable
            maxLength={80}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              kind === "problem" ? "Approve button does nothing" : "Sort parts by vendor"
            }
          />
        </Field>
        <Field
          label={kind === "problem" ? "What happened?" : "What would help?"}
          hint="You'll send it from Gearbox's GitHub, which needs a GitHub account. Reports there are public, with this page's address, the app's and platform's versions, your browser and the team's number. Leave out other people's names and anything private."
        >
          <TextField
            multiline
            typeable
            rows={5}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              kind === "problem"
                ? "What you did, what you expected, and what happened instead"
                : "What you'd like Gearbox to do"
            }
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {ready ? (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
              className={buttonClass()}
            >
              Open on GitHub
            </a>
          ) : (
            <Button disabled>Open on GitHub</Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
