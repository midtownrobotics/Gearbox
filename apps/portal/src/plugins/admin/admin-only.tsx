import { appUrl } from "@g3/site-config";
import type { ReactNode } from "react";
import { useMe } from "../../shared/me";

/** The team's admin pages: for its admins only (the platform and G3ID check again). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me === undefined) return null;
  if (me === null) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12 text-center">
        <p className="mb-4 text-secondary-700">Sign in to manage your team.</p>
        <a
          href={`${appUrl("id")}/login?redirect=${encodeURIComponent(window.location.href)}`}
          className="inline-block rounded-lg bg-primary-600 px-5 py-2 font-semibold text-white hover:bg-primary-700"
        >
          Sign in
        </a>
      </main>
    );
  }
  if (!me.isAdmin) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-12 text-center text-secondary-700">
        Only your team's admins can manage the team.
      </main>
    );
  }
  return <>{children}</>;
}
