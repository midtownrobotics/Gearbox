import { useState } from "react";
import { FaCheck } from "react-icons/fa";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { Page } from "./layout";

// Reporting a team number that someone else signed up. An operator follows up by email.

const field =
  "w-full rounded-lg border border-secondary-300 bg-surface px-3 py-2 text-secondary-900 focus:border-primary-500 focus:outline-none";

export function ReportPage() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    teamNumber: params.get("team") ?? "",
    email: "",
    name: "",
    message: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<typeof form>) => setForm({ ...form, ...change });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.reports.$post({
        json: { ...form, teamNumber: Number(form.teamNumber) },
      });
      if (res.ok) {
        setSent(true);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:py-16 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-widest text-primary-500">
            Report a team number
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-secondary-900">
            Someone signed up your team?
          </h1>
          <p className="text-secondary-600">
            Each FRC team number can be on Gearbox once. If yours was taken by people who aren't
            your team, tell us. We'll check with you by email and give the number back to the real
            team.
          </p>
          <p className="text-sm text-secondary-500">
            A team found to be falsely registered may be deleted, with all of its data, for good.
          </p>
        </div>
        <div className="space-y-4">
          {error && (
            <p className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-700">
              {error}
            </p>
          )}
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
            {sent ? (
              <div className="space-y-3 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary-600 text-white">
                  <FaCheck />
                </span>
                <h2 className="text-lg font-semibold text-secondary-900">Thanks, we have it.</h2>
                <p className="text-sm text-secondary-600">
                  We'll be in touch at <strong>{form.email}</strong>.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-secondary-700">Team number</span>
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.teamNumber}
                    onChange={(e) => set({ teamNumber: e.target.value })}
                    className={field}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-secondary-700">Your email</span>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => set({ email: e.target.value })}
                    className={field}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-secondary-700">
                    Your name <span className="font-normal text-secondary-500">(optional)</span>
                  </span>
                  <input
                    maxLength={100}
                    value={form.name}
                    onChange={(e) => set({ name: e.target.value })}
                    className={field}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-secondary-700">
                    How are you connected to this team?
                  </span>
                  <textarea
                    required
                    rows={4}
                    maxLength={2000}
                    value={form.message}
                    onChange={(e) => set({ message: e.target.value })}
                    placeholder="For example: I'm a mentor on this team, and we didn't sign up."
                    className={field}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 py-2.5 font-semibold text-white transition-colors"
                >
                  Send report
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </Page>
  );
}
