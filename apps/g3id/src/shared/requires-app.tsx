import { appUrl } from "@g3/site-config";
import { useAppOn, useTeamNames } from "@g3/ui";
import type { ReactNode } from "react";

/**
 * A page that shows another app's data (the Leaderboard and Attendance Settings are Attendance's):
 * while the team has that app off, a note instead of the page.
 */
export function RequiresApp({
  app,
  name,
  children,
}: {
  app: string;
  name: string;
  children: ReactNode;
}) {
  const on = useAppOn(app);
  const title = useTeamNames().appTitle(name);
  if (on !== false) return <>{children}</>;
  return (
    <main className="flex-1 px-6 py-12 max-w-xl mx-auto w-full text-center">
      <p className="text-secondary-700">
        This page needs {title}, which your team has switched off. An admin can switch it on from
        the{" "}
        <a href={`${appUrl("portal")}/admin`} className="font-semibold text-primary-600 underline">
          Apps page
        </a>
        .
      </p>
    </main>
  );
}
