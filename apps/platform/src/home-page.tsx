import { site } from "@g3/site-config";
import { type ReactNode, useEffect, useState } from "react";
import { FaCheck, FaCodeBranch, FaGithub, FaServer, FaSlack } from "react-icons/fa";
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

// The platform's public page. Temporary marketing copy until the app library (roadmap Phase 4).

type App = { name: string; icon: string; blurb: string };

const APPS: App[] = [
  {
    name: "Sign-in",
    icon: idIcon,
    blurb:
      "One account for every app. Members sign in with your team's Slack, and shop computers use 3-digit kiosk PINs.",
  },
  {
    name: "Orders",
    icon: ordersIcon,
    blurb:
      "Part requests from any member, mentor approvals, budgets by category, and carts grouped by vendor.",
  },
  {
    name: "Inventory",
    icon: inventoryIcon,
    blurb:
      "Everything your team owns and where it is: in storage by location, or in use on a robot. Received orders go straight in.",
  },
  {
    name: "Shop",
    icon: shopIcon,
    blurb:
      "Track every manufactured part from your CAD's bill of materials through each process, and print drawings.",
  },
  {
    name: "Pit",
    icon: pitIcon,
    blurb:
      "Competition days: battery tracking, pit checklists, and a pit monitor for the next match.",
  },
  {
    name: "Scouting",
    icon: scoutingIcon,
    blurb: "Scouting forms, pick-list tier lists, field maps and a library of autos for strategy.",
  },
  {
    name: "Skill Tree",
    icon: skillsIcon,
    blurb: "Each student's skills as a tree, with mentors signing off progress as they learn.",
  },
  {
    name: "Attendance",
    icon: attendanceIcon,
    blurb: "Sign in and out at a kiosk, with hours that add up to a season leaderboard.",
  },
];

const STEPS = [
  {
    title: "Tell us your team",
    body: "Your FRC number, name and country. One team per number.",
  },
  {
    title: `Add ${site.slackBotName} to your Slack`,
    body: `One click installs ${site.slackBotName} in your team's workspace. It's how everyone signs in.`,
  },
  {
    title: "Send it a code",
    body: `DM ${site.slackBotName} the code on screen. You're your team's first admin, and your apps are live.`,
  },
];

const FEATURES = [
  "Free, with no ads and nothing to buy",
  "Open source under the MIT license",
  "Sign-in through your team's own Slack",
  "Roles for admins, mentors and students",
  "Kiosk PINs for shared shop computers",
  "Light and dark mode on every app",
  "Your team's data stays your team's",
];

const FAQ = [
  {
    q: "What does it cost?",
    a: "Nothing. Gearbox is free, and run by volunteers.",
  },
  {
    q: "Do our members need new accounts?",
    a: "They sign in with your team's Slack. The first time, they send the bot a code, and an admin approves them.",
  },
  {
    q: "Who can see our data?",
    a: "Only your team's members, by role. Every team's sign-ins and data are kept apart, and members must be 13 or older.",
  },
  {
    q: "Who built this?",
    a: `${site.team.name}, FRC Team ${site.team.number}, who've run their own season on these apps, and anyone who sends a pull request.`,
  },
  {
    q: "Is it really open source?",
    a: "Yes. Every line is on GitHub under the MIT license: read it, run your own copy, or change it and send the change back.",
  },
];

export function HomePage() {
  return (
    <Page>
      <Hero />
      <Apps />
      <OpenSource />
      <HowItWorks />
      <Features />
      <Faq />
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
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-secondary-900 sm:text-6xl">
            The Linux of FRC productivity platforms.
          </h1>
          <p className="max-w-xl text-lg text-secondary-600">
            Gearbox is free, open-source software that runs your FIRST Robotics Competition team:
            ordering, shop tracking, scouting, attendance and more, behind one sign-in with your
            team's Slack.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/signup"
              className="rounded-lg bg-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-primary-500"
            >
              Sign up your team
            </Link>
            <a
              href={site.sourceUrl}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface px-6 py-3 font-semibold text-secondary-900 transition-colors hover:border-primary-500"
            >
              <FaGithub /> View the source
            </a>
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
  { app: "Orders", label: "Order approved", text: '4× 1/2" hex bearings' },
  { app: "Shop", label: "Part finished", text: "Intake side plate · 2 of 2 cut" },
  { app: "Pit", label: "Battery ready", text: "Battery 7 charged for Q42" },
  { app: "Scouting", label: "Pick list updated", text: "Team 254 moved to the top tier" },
  { app: "Skill Tree", label: "Skill signed off", text: "CAD Basics · complete" },
  { app: "Sign-in", label: "New member", text: "Jordan joined from Slack" },
];

const LAUNCHER_APPS = APPS.filter((app) => app.name !== "Attendance" && app.name !== "Inventory");

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

const OPEN = [
  {
    icon: FaGithub,
    title: "MIT licensed",
    body: "Use it, change it, share it. No license fees, no lock-in, no catch.",
  },
  {
    icon: FaCodeBranch,
    title: "Contributions welcome",
    body: "Every change is a public pull request, and yours are wanted. Found a bug or want a feature? Open an issue or send a PR.",
  },
  {
    icon: FaServer,
    title: "Run it yourself",
    body: "Prefer your own servers? One config file sets your team, domain and name.",
  },
];

function OpenSource() {
  return (
    <section className="border-t border-line bg-[#111111]">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 sm:py-20 lg:grid-cols-[1fr_1fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-[#e05a6f]">
            Open source
          </p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#ffffff] sm:text-4xl">
            Built by the FRC community.
          </h2>
          <p className="mt-4 text-[#b8b8b8]">
            Gearbox isn't a product you rent. It's software teams share, started by {site.team.name}{" "}
            and better with every team that pitches in.
          </p>
          <p className="mt-3 text-[#b8b8b8]">
            We want your pull requests: bug fixes, new features, docs, even whole new apps, from
            students and mentors alike.
          </p>
          <ul className="mt-8 space-y-5">
            {OPEN.map(({ icon: Icon, title, body }) => (
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
    <Section id="how" eyebrow="How it works" title="From sign-up to your first order in minutes.">
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

function Features() {
  return (
    <Section eyebrow="Built in" title="The boring parts, done for you.">
      <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-secondary-700">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-600">
              <FaCheck size={10} />
            </span>
            {feature}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Faq() {
  return (
    <Section id="faq" eyebrow="Questions" title="Good to know.">
      <dl className="grid gap-6 md:grid-cols-2">
        {FAQ.map((item) => (
          <div key={item.q} className="rounded-xl border border-line bg-surface p-6">
            <dt className="font-semibold text-secondary-900">{item.q}</dt>
            <dd className="mt-2 text-sm text-secondary-600">{item.a}</dd>
          </div>
        ))}
      </dl>
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
