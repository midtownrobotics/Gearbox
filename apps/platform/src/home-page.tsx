import { type AppName, demoTeamId, site, teamAppUrl } from "@g3/site-config";
import { type ReactNode, useEffect, useState } from "react";
import {
  FaCodeBranch,
  FaGithub,
  FaPalette,
  FaServer,
  FaSlack,
  FaSlidersH,
  FaToggleOn,
  FaUserShield,
} from "react-icons/fa";
import { Link } from "react-router-dom";
import attendanceIcon from "./assets/app-icons/attendance.svg";
import edgeIcon from "./assets/app-icons/edge.svg";
import inventoryIcon from "./assets/app-icons/inventory.svg";
import ordersIcon from "./assets/app-icons/orders.svg";
import pitIcon from "./assets/app-icons/pit.svg";
import scheduleIcon from "./assets/app-icons/schedule.svg";
import scoutingIcon from "./assets/app-icons/scouting.svg";
import shopIcon from "./assets/app-icons/shop.svg";
import skillsIcon from "./assets/app-icons/skills.svg";
import { Page } from "./layout";
import { MyTeamButton } from "./team-pages";

// The platform's public page: what Gearbox is, its apps, how to try them in the demo, how to sign
// up, and that it's open source. Every section is a click from the demo, which shows the product.

/**
 * `demo`: the app in the public demo, where its card and launcher tile link. `soon`: not open to
 * other teams yet (Edge: only its box link is done, roadmap "Edge: an app any team can run").
 */
type App = { name: string; icon: string; blurb: string; demo: AppName; soon?: boolean };

const APPS: App[] = [
  {
    name: "Orders",
    demo: "orders",
    icon: ordersIcon,
    blurb:
      "Paste a vendor link or pick from the FRC parts catalog. Mentors approve, carts build themselves per vendor, and budgets only count money actually spent.",
  },
  {
    name: "Shop",
    demo: "shop",
    icon: shopIcon,
    blurb:
      "Parts released in Onshape show up ready to make. Students pick up and finish each step from a phone or a shop kiosk, with drawings a scan away.",
  },
  {
    name: "Pit",
    demo: "pit",
    icon: pitIcon,
    blurb:
      "Checklists before every match, an issue log, battery health and cycle counts, and a monitor showing the schedule and rankings.",
  },
  {
    name: "Scouting",
    demo: "scouting",
    icon: scoutingIcon,
    blurb:
      "Your own match and pit forms, pick lists and strategy tools, shared with the whole team. Turn on a points game to keep scouts engaged.",
  },
  {
    name: "Inventory",
    demo: "inventory",
    icon: inventoryIcon,
    blurb:
      "What you own and where it lives, on a shelf or on a robot. Deliveries from Orders land here automatically.",
  },
  {
    name: "Attendance",
    demo: "attendance",
    icon: attendanceIcon,
    blurb:
      "Members scan a QR code at the door to check in and out. Hours roll up into a season leaderboard, and missed check-outs fix themselves.",
  },
  {
    name: "Skill Tree",
    demo: "skillTree",
    icon: skillsIcon,
    blurb:
      "Training laid out as skills that unlock one after another. Mentors sign off individuals or whole groups, using our trees or yours.",
  },
  {
    name: "Schedule",
    demo: "schedule",
    icon: scheduleIcon,
    blurb:
      "Who does what at each event, 15 minutes at a time. Drag roles across the grid, publish it, and Slack reminds people before their role changes.",
  },
  {
    name: "Edge",
    demo: "edge",
    icon: edgeIcon,
    soon: true,
    blurb:
      "With a small box on your shop's network: see how much data each device uses, block distractions, and print from any app.",
  },
];

/** What every app shares: one line after the apps. */
const SHARED = [
  { icon: FaSlack, text: "One sign-in through your team's Slack" },
  { icon: FaUserShield, text: "Admin, mentor and student roles in every app" },
  { icon: FaPalette, text: "Your name, logo and colors everywhere" },
];

const CUSTOMIZE = [
  {
    icon: FaToggleOn,
    title: "Pick your apps",
    body: "Team admins turn apps on or off whenever they like. Use one, use them all.",
  },
  {
    icon: FaSlidersH,
    title: "Fill them with your process",
    body: "Your budget categories, shop steps, checklists, scouting forms and skill trees. Nothing in the apps assumes how our team works.",
  },
  {
    icon: FaCodeBranch,
    title: "Build your own",
    body: "Fork an app into the version your team wants, or write a new one, and send it as a pull request.",
  },
  {
    icon: FaServer,
    title: "Run your own copy",
    body: "Everything deploys to a Cloudflare account, so you can host Gearbox yourself with your data on your own terms.",
  },
];

const DEMO_ROLES = ["student", "mentor", "admin"] as const;

/** Into the demo as a role, through its sign-in page. */
const demoAs = (role: (typeof DEMO_ROLES)[number]) =>
  `${teamAppUrl(demoTeamId, "id")}/demo?role=${role}`;

const STEPS = [
  {
    title: "Enter your team number",
    body: "Your FRC number, name and country. One team per number.",
  },
  {
    title: `Add ${site.slackBotName} to your Slack`,
    body: `One click installs ${site.slackBotName} in your team's workspace. It's how everyone signs in.`,
  },
  {
    title: "Send it the code on screen",
    body: `DM ${site.slackBotName} the code. You're your team's first admin, and your apps are live.`,
  },
];

export function HomePage() {
  return (
    <Page>
      <Hero />
      <Apps />
      <Shared />
      <Demo />
      <HowItWorks />
      <OpenSource />
      <FinalCall />
    </Page>
  );
}

/** "Try it as a student", "… a mentor", "… an admin": small buttons into the demo. */
function DemoButtons({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {DEMO_ROLES.map((role) => (
        <a
          key={role}
          href={demoAs(role)}
          className={`rounded-lg border px-4 py-2 text-sm font-semibold shadow-sm transition-colors ${
            dark
              ? "border-[#333333] bg-[#1a1a1a] text-[#ffffff] hover:bg-[#262626]"
              : "border-line bg-surface text-secondary-900 hover:bg-inset"
          }`}
        >
          Try it as {role === "admin" ? "an" : "a"} {role}
        </a>
      ))}
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute -top-40 right-[-10%] h-[520px] w-[520px] rounded-full bg-primary-500/10 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary-500">
            Free · Open source · Built by FRC Team {site.team.number}
          </p>
          <div className="space-y-3">
            <span className="inline-block rounded-full border border-primary-200 bg-primary-50 px-3 py-0.5 text-xs font-semibold text-primary-700">
              Open beta
            </span>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-secondary-900 sm:text-5xl">
              Run your whole team from one place.
            </h1>
          </div>
          <p className="max-w-xl text-lg text-secondary-600">
            Orders, shop tracking, pit checklists and scouting that all share one sign-in through
            your team's Slack. Free, open source, and built by an FRC team.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/signup"
              className="rounded-lg bg-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-primary-500"
            >
              Sign up your team
            </Link>
            <MyTeamButton large />
          </div>
          <DemoButtons />
          <div className="space-y-1 text-sm text-secondary-500">
            <p>
              Takes about two minutes. You'll need to be able to add an app to your team's Slack.
            </p>
            <p>Tested by {site.team.name} through the 2026 offseason.</p>
          </div>
        </div>
        <LauncherMock />
      </div>
    </section>
  );
}

/** A moment from each app, shown in turn on the launcher mock. */
const MOMENTS: { app: string; label: string; text: string }[] = [
  { app: "Orders", label: "Order approved", text: '4× 1/2" hex bearings' },
  { app: "Shop", label: "Part finished", text: "Intake side plate · 2 of 2 cut" },
  { app: "Pit", label: "Battery ready", text: "Battery 7 charged for Q42" },
  { app: "Scouting", label: "Pick list updated", text: "Team 9999 moved to the top tier" },
  { app: "Schedule", label: "Shift reminder", text: "Pit crew shift starts in 15 min" },
  { app: "Skill Tree", label: "Skill signed off", text: "CAD Basics · complete" },
];

const LAUNCHER_APPS = MOMENTS.map((moment) => APPS.find((app) => app.name === moment.app) as App);

/** How long each moment shows, long enough to read. */
const MOMENT_MS = 4300;

/** What a team's home looks like once it's signed up, with a moment from each app in turn. */
function LauncherMock() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const moment = MOMENTS[index];
  const app = LAUNCHER_APPS[index];

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => setIndex((index + 1) % MOMENTS.length), MOMENT_MS);
    return () => clearTimeout(timer);
  }, [index, paused]);

  return (
    <div
      className="relative mx-auto w-full max-w-md"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="rotate-1 rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-500">
              Team 9999
            </p>
            <p className="text-xl font-bold text-secondary-900">Your Team Here</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-inset px-3 py-1 text-xs text-secondary-600">
            <FaSlack /> Signed in
          </span>
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-5">
          {LAUNCHER_APPS.map((tile, i) => {
            const active = i === index;
            return (
              <a
                key={tile.name}
                href={teamAppUrl(demoTeamId, tile.demo)}
                onFocus={() => setIndex(i)}
                className="flex flex-col items-center gap-1.5"
                aria-label={`Open ${tile.name} in the demo`}
              >
                <span
                  className={`rounded-[13px] p-0.5 transition-all duration-300 ${
                    active ? "scale-110 ring-2 ring-primary-500" : "opacity-60 hover:opacity-100"
                  }`}
                >
                  <AppTile app={tile} size="sm" />
                </span>
                <span
                  className={`text-[11px] transition-colors ${
                    active ? "font-semibold text-secondary-900" : "text-secondary-500"
                  }`}
                >
                  {tile.name}
                </span>
              </a>
            );
          })}
        </div>
      </div>
      {/* Kept inside the screen on a narrow phone; it overhangs the card from sm up. */}
      <div
        aria-live="polite"
        className="absolute -bottom-6 left-0 w-64 max-w-[85%] -rotate-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg sm:-left-4"
      >
        <div key={index} className="moment-in flex items-center gap-3 px-4 py-3">
          <img src={app.icon} alt="" className="h-8 w-8 shrink-0 rounded-[7px]" />
          <div className="min-w-0">
            <p className="text-xs text-secondary-500">{moment.label}</p>
            <p className="truncate text-sm font-semibold text-secondary-900">{moment.text}</p>
          </div>
        </div>
        <div className="flex gap-1 px-4 pb-2.5">
          {MOMENTS.map((m, i) => (
            <span
              key={m.app}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i === index ? "bg-primary-500" : "bg-inset"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AppTile({ app, size }: { app: App; size: "sm" | "lg" }) {
  const box = size === "sm" ? "h-12 w-12 rounded-[11px]" : "h-14 w-14 rounded-[13px]";
  return <img src={app.icon} alt="" className={`${box} shrink-0 shadow-md`} />;
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-line">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:py-20">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary-500">
          {eyebrow}
        </p>
        <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight text-secondary-900 sm:text-4xl">
          {title}
        </h2>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function Apps() {
  return (
    <Section id="apps" eyebrow="The apps" title="Everything a build season runs on.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {APPS.map((app) => (
          <a
            key={app.name}
            href={teamAppUrl(demoTeamId, app.demo)}
            className="group flex gap-4 rounded-xl border border-line bg-surface p-5 transition-shadow hover:border-primary-500 hover:shadow-md"
          >
            <AppTile app={app} size="lg" />
            <div className="flex flex-col">
              <h3 className="flex flex-wrap items-center gap-2 font-semibold text-secondary-900">
                {app.name}
                {app.soon && (
                  <span className="rounded-full bg-inset px-2 py-0.5 text-xs font-medium text-secondary-600">
                    Coming soon
                  </span>
                )}
              </h3>
              <p className="mt-1 flex-1 text-sm text-secondary-600">{app.blurb}</p>
              <span className="mt-3 text-sm font-semibold text-primary-600 group-hover:text-primary-700">
                See it in the demo →
              </span>
            </div>
          </a>
        ))}
      </div>
      <p className="mt-6 text-sm text-secondary-600">Turn on only the ones your team needs.</p>
    </Section>
  );
}

/** What every app shares, in one strip. */
function Shared() {
  return (
    <section className="border-t border-line bg-inset">
      <ul className="mx-auto grid max-w-6xl gap-4 px-5 py-8 sm:grid-cols-3">
        {SHARED.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-sm font-medium text-secondary-900">
            <span className="text-primary-600">
              <Icon />
            </span>
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Demo() {
  return (
    <section id="demo" className="scroll-mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-14 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-primary-500">Try it</p>
          <p className="mt-2 text-xl font-semibold text-secondary-900">
            A whole team mid-season, no account needed. Resets nightly.
          </p>
        </div>
        <DemoButtons />
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <Section id="how" eyebrow="Set up your team" title="Live in a couple of minutes.">
      <ol className="grid gap-6 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative rounded-xl border border-line bg-surface p-6">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 font-bold text-white">
              {i + 1}
            </span>
            <h3 className="mt-4 font-semibold text-secondary-900">{step.title}</h3>
            <p className="mt-1 text-sm text-secondary-600">{step.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-secondary-600">
        After that, members send the bot a code to join, and you approve them.
      </p>
    </Section>
  );
}

function OpenSource() {
  return (
    <section id="open-source" className="scroll-mt-16 border-t border-line bg-[#111111]">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-20 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-[#e05a6f]">
            Open source
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#ffffff] sm:text-4xl">
            Shape it to how your team works.
          </h2>
          <p className="mt-4 text-[#b8b8b8]">
            Customize Gearbox as deeply as your team wants. It's MIT licensed, and every change is a
            public pull request.
          </p>
          <ul className="mt-8 space-y-5">
            {CUSTOMIZE.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2a2a2a] text-[#ffffff]">
                  <Icon />
                </span>
                <div>
                  <h3 className="font-semibold text-[#ffffff]">{title}</h3>
                  <p className="mt-0.5 text-sm text-[#b8b8b8]">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <a
            href={`${site.sourceUrl}/issues`}
            className="mt-8 inline-block text-sm font-semibold text-[#e05a6f] hover:text-[#ffffff]"
          >
            Missing something? Open an issue →
          </a>
        </div>
        <div className="overflow-hidden rounded-xl border border-[#333333] bg-[#0a0a0a] font-mono text-sm shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-[#333333] px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <pre className="overflow-x-auto p-5 leading-7 text-[#d4d4d4]">
            <span className="text-[#6a6a6a]"># every app, on your machine</span>
            {"\n"}
            <span className="text-[#e05a6f]">$</span> git clone{" "}
            {site.sourceUrl.replace("https://", "")}
            {"\n"}
            <span className="text-[#e05a6f]">$</span> cd {site.sourceUrl.split("/").pop()} && pnpm
            install
            {"\n"}
            <span className="text-[#e05a6f]">$</span> pnpm dev
            {"\n"}
            <span className="text-[#28c840]">✓</span> g3id, orders, shop, pit, scouting …
          </pre>
          <a
            href={site.sourceUrl}
            className="flex items-center justify-center gap-2 border-t border-[#333333] py-3 font-sans text-sm font-semibold text-[#ffffff] hover:bg-[#1a1a1a]"
          >
            <FaGithub /> Contribute on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function FinalCall() {
  return (
    <section className="bg-[#1a1a1a]">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-[#ffffff]">Get set up before Kickoff.</h2>
          <p className="mt-2 text-[#b8b8b8]">Set your team up now. It's free.</p>
        </div>
        <Link
          to="/signup"
          className="rounded-lg bg-primary-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-primary-500"
        >
          Sign up your team
        </Link>
      </div>
    </section>
  );
}
