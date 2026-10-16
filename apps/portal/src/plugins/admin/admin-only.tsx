import { redirectToSignIn } from "@g3/ui";
import type { ReactNode } from "react";
import { useMe } from "../../shared/me";

/** The team's admin pages: for its admins only (the platform and G3ID check again). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me === undefined) return null;
  if (me === null) {
    redirectToSignIn();
    return null;
  }
  if (!me.isAdmin) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 text-center text-secondary-700">
        Only your team's admins can manage the team.
      </main>
    );
  }
  return <>{children}</>;
}
