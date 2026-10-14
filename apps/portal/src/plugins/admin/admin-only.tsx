import { appUrl } from "@g3/site-config";
import { buttonClass } from "@g3/ui";
import type { ReactNode } from "react";
import { useMe } from "../../shared/me";

/** The team's admin pages: for its admins only (the platform and G3ID check again). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me === undefined) return null;
  if (me === null) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 text-center">
        <p className="mb-4 text-secondary-700">Sign in to manage your team.</p>
        <a
          href={`${appUrl("id")}/login?redirect=${encodeURIComponent(window.location.href)}`}
          className={buttonClass()}
        >
          Sign in
        </a>
      </main>
    );
  }
  if (!me.isAdmin) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 text-center text-secondary-700">
        Only your team's trusted students can manage the team.
      </main>
    );
  }
  return <>{children}</>;
}
