import { site } from "@g3/site-config";
import { type ReactNode, useEffect, useState } from "react";
import {
  FaCodeBranch,
  FaGithub,
  FaHome,
  FaPalette,
  FaServer,
  FaSlack,
  FaSlidersH,
  FaToggleOn,
  FaUserShield,
} from "react-icons/fa";
import { Link } from "react-router-dom";
import attendanceIcon from "./assets/app-icons/attendance.svg";
import idIcon from "./assets/app-icons/id.svg";
import inventoryIcon from "./assets/app-icons/inventory.svg";
import ordersIcon from "./assets/app-icons/orders.svg";
import pitIcon from "./assets/app-icons/pit.svg";
import scoutingIcon from "./assets/app-icons/scouting.svg";
import shopIcon from "./assets/app-icons/shop.svg";
import skillsIcon from "./assets/app-icons/skills.svg";
import { Page } from "./layout";
import { MyTeamButton } from "./team-pages";

// The platform's public page: what Gearbox is, its apps, how a team makes it its own, and how to
// sign up. Written from the release announcement.

type App = { name: string; icon: string; blurb: string };

/** Sign-in, on every team: in the launcher mock, not the app list. */
const SIGN_IN: App = { name: "Sign-in", icon: idIcon, blurb: "" };

const APPS: App[] = [
  {
    name: "Orders",
    icon: ordersIcon,
    blurb:
      "Paste a vendor link or pick from the FRC parts catalog. Mentors approve, carts build themselves per vendor, and budgets only count money actually spent.",
  },
  {
    name: "Shop",
    icon: shopIcon,
    blurb:
      "Parts released in Onshape show up ready to make. Students pick up and finish each step from a phone or a shop kiosk, with drawings a scan away.",
  },
  {
    name: "Pit",
    icon: pitIcon,
    blurb:
      "Checklists before every match, an issue log, battery health and cycle counts, and a monitor showing the schedule and rankings.",
  },
  {
    name: "Scouting",
    icon: scoutingIcon,
    blurb:
      "Your own match and pit forms, pick lists and strategy tools, shared with the whole team. Turn on a points game to keep scouts engaged.",
  },
  {
    name: "Inventory",
    icon: inventoryIcon,
    blurb:
      "What you own and where it lives, on a shelf or on a robot. Deliveries from Orders land here automatically.",
  },
  {
    name: "Attendance",
    icon: attendanceIcon,
    blurb:
      "Members scan a QR code at the door to check in and out. Hours roll up into a season leaderboard, and missed check-outs fix themselves.",
  },
  {
    name: "Skill Tree",
    icon: skillsIcon,
    blurb:
      "Training laid out as skills that unlock one after another. Mentors sign off individuals or whole groups, using our trees or yours.",
  },
];

const FOUNDATION = [
  {
    icon: FaSlack,
    title: "Sign in once",
    body: "Members join from your Slack workspace and an admin lets them in. That one account works in every app. (Slack is required today; other options are planned.)",
  },
  {
    icon: FaUserShield,
    title: "Roles that follow you",
    body: "Admin, mentor or student is set once and respected everywhere, so mentors approve orders and sign off skills with the same account.",
  },
  {
    icon: FaHome,
    title: "A home for your team",
    body: "Your own address on frcgearbox.com with your apps and the links your team uses most, from your website to The Blue Alliance.",
  },
  {
    icon: FaPalette,
    title: "Your colors, everywhere",
    body: "Set your name, logo and colors once and every app picks them up, light mode and dark.",
  },
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
      <Foundation />
      <Apps />
      <MakeItYours />
      <HowItWorks />
      <Feedback />
      <Thanks />
      <FinalCall />
    </Page>
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
            FRC productivity for the modern era
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-secondary-900 sm:text-5xl">
            Run your whole team from one place.
          </h1>
          <p className="max-w-xl text-lg text-secondary-600">
            Parts, shop, pit, scouting, attendance and training in apps that share your members,
            roles and branding. Free, open source and made by an FRC team.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/signup"
              className="rounded-lg bg-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-primary-500"
            >
              Sign up your team
            </Link>
            <MyTeamButton large />
          </div>
          <p className="text-sm text-secondary-500">
            Takes about two minutes. You'll need to be able to add an app to your team's Slack.
          </p>
        </div>
        <LauncherMock />
      </div>
    </section>
  );
}

/** A moment from each app, shown in turn on the launcher mock. */
const MOMENTS: { app: string; label: string; text: string }[] = [
  { app: "Sign-in", label: "New member", text: "Jordan joined from Slack" },
  { app: "Orders", label: "Order approved", text: '4× 1/2" hex bearings' },
  { app: "Shop", label: "Part finished", text: "Intake side plate · 2 of 2 cut" },
  { app: "Pit", label: "Battery ready", text: "Battery 7 charged for Q42" },
  { app: "Scouting", label: "Pick list updated", text: "Team 9999 moved to the top tier" },
  { app: "Skill Tree", label: "Skill signed off", text: "CAD Basics · complete" },
];

const LAUNCHER_APPS = [
  SIGN_IN,
  ...APPS.filter((app) => app.name !== "Attendance" && app.name !== "Inventory"),
];

/** What a team's home looks like once it's signed up, with a moment from each app in turn. */
function LauncherMock() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const moment = MOMENTS[index];
  const app = LAUNCHER_APPS.find((a) => a.name === moment.app) ?? LAUNCHER_APPS[0];

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => setIndex((index + 1) % MOMENTS.length), 3200);
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
          {LAUNCHER_APPS.map((tile) => {
            const active = tile.name === moment.app;
            return (
              <button
                key={tile.name}
                type="button"
                onClick={() => setIndex(MOMENTS.findIndex((m) => m.app === tile.name))}
                className="flex flex-col items-center gap-1.5"
                aria-label={`Show ${tile.name}`}
              >
                <span
                  className={`rounded-[13px] p-0.5 transition-all duration-300 ${
                    active ? "scale-110 ring-2 ring-primary-500" : "opacity-60"
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
              </button>
            );
          })}
        </div>
      </div>
      <div
        aria-live="polite"
        className="absolute -bottom-6 -left-4 w-64 -rotate-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
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

function Foundation() {
  return (
    <Section eyebrow="Why Gearbox" title="Stop juggling a dozen tools.">
      <p className="-mt-4 mb-10 max-w-3xl text-secondary-600">
        Spreadsheets, forms and whiteboards each want their own login and their own roster. Gearbox
        started as {site.team.name}'s ({site.team.number}) answer to that, and now any team can use
        it.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {FOUNDATION.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-4 rounded-xl border border-line bg-surface p-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Icon />
            </span>
            <div>
              <h3 className="font-semibold text-secondary-900">{title}</h3>
              <p className="mt-1 text-sm text-secondary-600">{body}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Apps() {
  return (
    <Section id="apps" eyebrow="The apps" title="Everything a build season runs on.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {APPS.map((app) => (
          <div
            key={app.name}
            className="flex gap-4 rounded-xl border border-line bg-surface p-5 transition-shadow hover:shadow-md"
          >
            <AppTile app={app} size="lg" />
            <div>
              <h3 className="font-semibold text-secondary-900">{app.name}</h3>
              <p className="mt-1 text-sm text-secondary-600">{app.blurb}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function MakeItYours() {
  return (
    <section id="customize" className="scroll-mt-16 border-t border-line bg-[#111111]">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-20 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-[#e05a6f]">
            Make it yours
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
            <span className="text-[#e05a6f]">$</span> cd Gearbox && pnpm install
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

function Feedback() {
  return (
    <Section eyebrow="Feedback" title="Something missing for your team?">
      <div className="max-w-3xl space-y-4 text-secondary-600">
        <p>
          We built these apps around our own season, so they won't suit everyone out of the box. Let
          us know what would make Gearbox work for you, or borrow the ideas for your own tools.
        </p>
        <a
          href={site.sourceUrl}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-5 py-2.5 font-semibold text-secondary-900 transition-colors hover:border-primary-500"
        >
          <FaGithub /> Share feedback on GitHub
        </a>
      </div>
    </Section>
  );
}

function Thanks() {
  return (
    <Section eyebrow="Thanks" title="Standing on the shoulders of other teams.">
      <ul className="grid max-w-4xl gap-4 text-sm text-secondary-600 md:grid-cols-3">
        <li className="rounded-xl border border-line bg-surface p-5">
          Team 4414's TideApps showed us what team-built web apps could be.
        </li>
        <li className="rounded-xl border border-line bg-surface p-5">
          Our Onshape integration builds on work by Team 6328, FRCBOM's David Masin and crummyh.
        </li>
        <li className="rounded-xl border border-line bg-surface p-5">
          Orders takes cues from FRCTools, and its catalog grew out of the FRCDesign library.
        </li>
      </ul>
    </Section>
  );
}

function FinalCall() {
  return (
    <section className="bg-[#1a1a1a]">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-16 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold text-[#ffffff]">Ready for build season?</h2>
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
