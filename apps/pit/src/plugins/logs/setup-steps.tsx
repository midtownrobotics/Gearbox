import { site, teamAppUrlVia } from "@g3/site-config";
import { Button, Chip, useTeamNames } from "@g3/ui";
import { type ReactNode, useState } from "react";

// How to set up the pit log downloader (devices/pit-log-downloader) on a computer, for each
// system: Git, Node.js and pnpm, the code, the team's settings, then starting it.

type System = "windows" | "macos" | "linux";

const SYSTEMS: { key: System; label: string }[] = [
  { key: "windows", label: "Windows" },
  { key: "macos", label: "macOS" },
  { key: "linux", label: "Linux" },
];

/** The system the page is open on, as a first guess. */
function guessSystem(): System {
  const agent = navigator.userAgent;
  if (/Windows/i.test(agent)) return "windows";
  if (/Mac OS X|Macintosh/i.test(agent) && !/iPhone|iPad/i.test(agent)) return "macos";
  return "linux";
}

/** nvm's installer: Node.js on macOS and Linux without admin rights. */
const NVM_INSTALL =
  "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash";

function Command({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-lg bg-inset px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-xs leading-5 text-secondary-900">
        {children}
      </pre>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(children).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary-100 text-xs font-bold text-secondary-700">
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-semibold text-secondary-900">{title}</p>
        {children}
      </div>
    </li>
  );
}

const Note = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-secondary-600">{children}</p>
);

export function SetupSteps() {
  const [system, setSystem] = useState<System>(guessSystem);
  const { number } = useTeamNames();
  // The downloader finds the team's usual Pit address from its number; anywhere else (staging,
  // a local Pit) it's told this one.
  const pitUrl = window.location.origin;
  const settings = [
    `TEAM_NUMBER=${number}`,
    ...(pitUrl === teamAppUrlVia(undefined, `frc${number}`, "pit") ? [] : [`PIT_URL=${pitUrl}`]),
  ];
  const windows = system === "windows";
  const configPath = windows
    ? "devices\\pit-log-downloader\\config.env"
    : "devices/pit-log-downloader/config.env";
  const writeConfig = windows
    ? `Set-Content ${configPath} "${settings.join("`n")}"`
    : `printf '${settings.join("\\n")}\\n' > ${configPath}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SYSTEMS.map((s) => (
          <Chip key={s.key} selected={system === s.key} onClick={() => setSystem(s.key)}>
            {s.label}
          </Chip>
        ))}
      </div>
      <ol className="space-y-5">
        {windows ? (
          <Step n={1} title="Install Git and Node.js">
            <Note>In PowerShell:</Note>
            <Command>
              {"winget install --id Git.Git -e\nwinget install --id OpenJS.NodeJS.LTS -e"}
            </Command>
            <Note>Then close PowerShell and open a new one.</Note>
          </Step>
        ) : (
          <Step n={1} title="Install Git and Node.js">
            <Note>In a terminal:</Note>
            <Command>
              {system === "macos"
                ? `xcode-select --install\n${NVM_INSTALL}`
                : `sudo apt install git    # or: sudo dnf install git\n${NVM_INSTALL}`}
            </Command>
            <Note>Then open a new terminal and install Node.js:</Note>
            <Command>nvm install --lts</Command>
          </Step>
        )}
        <Step n={2} title="Install pnpm and the downloader">
          <Command>
            {[
              "npm install -g pnpm",
              `git clone ${site.sourceUrl}.git`,
              "cd Gearbox",
              'pnpm install --filter "@g3/pit-log-downloader..."',
            ].join("\n")}
          </Command>
        </Step>
        <Step n={3} title="Set your team">
          <Command>{writeConfig}</Command>
        </Step>
        <Step n={4} title="Start it">
          <Command>pnpm --filter @g3/pit-log-downloader start</Command>
          <Note>
            Leave it running, open http://localhost:3000 on that computer and choose Pair with
            Gearbox.
          </Note>
        </Step>
      </ol>
    </div>
  );
}
