import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { buildInstanceRows, machineMood, matchMachineProcess } from "../../shared/derive";
import { processPath } from "../../shared/nav";
import { useAuthUser, useKiosk } from "../../shared/use-auth";
import { useShopData } from "../../shared/use-shop-data";

const MOOD_TONES = {
  calm: "bg-emerald-50 border-emerald-300 text-emerald-800",
  steady: "bg-steel-tint border-steel/40 text-steel-dark",
  warn: "bg-amber-50 border-amber-300 text-amber-800",
  hot: "bg-crimson-tint border-crimson/40 text-crimson-dark",
} as const;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function HomePage() {
  const navigate = useNavigate();
  const user = useAuthUser();
  const kiosk = useKiosk();
  const { data } = useShopData();
  const name = user?.displayName;

  useEffect(() => {
    if (!kiosk.active || !kiosk.machineName || !data) return;
    const machine = matchMachineProcess(data.processes, kiosk.machineName);
    if (machine) {
      navigate(processPath(machine.id), { replace: true });
    }
  }, [kiosk.active, kiosk.machineName, data, navigate]);

  const rows = data ? buildInstanceRows(data) : [];
  const doing = rows.filter((r) => r.state === "doing").length;
  const todo = rows.filter((r) => r.state === "todo").length;
  const complete = rows.filter((r) => r.state === "complete").length;

  // Kiosks named after a machine get a section scoped to that machine.
  const machineProcess =
    kiosk.active && data ? matchMachineProcess(data.processes, kiosk.machineName) : null;
  const machineDoing = machineProcess
    ? rows.filter((r) => r.current?.processId === machineProcess.id && r.current.status === "doing")
        .length
    : 0;
  const machineTodo = machineProcess
    ? rows.filter((r) => r.current?.processId === machineProcess.id && r.current.status === "todo")
        .length
    : 0;
  const machineDone = machineProcess
    ? rows.filter((r) =>
        r.procs.some((p) => p.processId === machineProcess.id && p.status === "done"),
      ).length
    : 0;
  const mood = machineProcess ? machineMood(machineTodo, machineDoing) : null;

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="min-h-screen bg-page">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <div>
          <p className="text-sm text-steel-dark">{today}</p>
          <h1 className="font-display text-5xl text-ink mt-1">
            {greeting()}
            {name ? `, ${name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-steel-dark mt-2">
            {kiosk.active && kiosk.machineName
              ? `${kiosk.machineName} kiosk — G3 Shop production tracking.`
              : "G3 Shop — production tracking and management."}
          </p>
        </div>

        {machineProcess && mood && (
          <section className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-widest text-steel">
              This Machine — {machineProcess.name}
            </h2>
            <Link
              to={processPath(machineProcess.id)}
              className={`block rounded-xl border px-5 py-4 transition-transform hover:-translate-y-0.5 ${MOOD_TONES[mood.tone]}`}
            >
              <p className="font-display text-3xl">{mood.label}</p>
              <p className="text-sm mt-0.5">{mood.blurb}</p>
            </Link>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Stat
                label="In Progress"
                value={data ? machineDoing : null}
                accent="text-amber-600"
              />
              <Stat
                label="Ready to Start"
                value={data ? machineTodo : null}
                accent="text-crimson"
              />
              <Stat label="Completed" value={data ? machineDone : null} accent="text-green-600" />
            </div>
          </section>
        )}

        {machineProcess && (
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-steel/25" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-steel shrink-0">
              Shop Overview
            </h2>
            <span className="h-px flex-1 bg-steel/25" />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat label="In Progress" value={data ? doing : null} accent="text-amber-600" />
          <Stat label="Ready to Start" value={data ? todo : null} accent="text-crimson" />
          <Stat label="Completed Parts" value={data ? complete : null} accent="text-green-600" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <QuickLink
            to="/parts"
            title="Parts"
            blurb="Browse every part in production, add new ones, and check status."
          />
          <QuickLink
            to={machineProcess ? processPath(machineProcess.id) : "/board"}
            title="Shop Floor"
            blurb={
              machineProcess
                ? `Jump to the ${machineProcess.name} queue and move parts forward.`
                : "See what each machine is working on and move parts forward."
            }
          />
          {kiosk.active ? (
            <QuickLink
              to="/leaderboard"
              title="Leaderboard"
              blurb="See who has completed the most parts."
            />
          ) : (
            <QuickLink to="/admin" title="Admin" blurb="Manage subsystems and shop processes." />
          )}
        </div>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | null;
  accent: string;
}) {
  return (
    <div className="bg-paper border border-steel/25 rounded-xl px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-steel">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${accent}`}>{value ?? "—"}</p>
    </div>
  );
}

function QuickLink({ to, title, blurb }: { to: string; title: string; blurb: string }) {
  return (
    <Link
      to={to}
      className="group bg-paper border border-steel/25 hover:border-crimson/50 rounded-xl px-5 py-4 transition-colors"
    >
      <p className="font-display text-2xl text-ink group-hover:text-crimson transition-colors">
        {title}
      </p>
      <p className="text-sm text-steel-dark mt-1">{blurb}</p>
    </Link>
  );
}
