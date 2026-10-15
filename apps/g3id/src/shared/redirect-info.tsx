import { DEV_DOMAIN, TEAM_HOST_APPS, platformLabel, portalAppLabels } from "@g3/site-config";
import { useTeamNames } from "@g3/ui";
import { useSearchParams } from "react-router-dom";

/**
 * The app someone is signing in to, from the address they'll go back to: `<number>-<app>.<domain>`
 * ("Skill Tree" from `skill-tree`), or the team's home, `<number>.<domain>` ("Portal").
 */
function appNameOf(redirect: string): string | null {
  try {
    // On the platform's domain, or the dev gateway's (like teamOfHost).
    const { hostname } = new URL(redirect);
    const label = hostname.endsWith(`.${DEV_DOMAIN}`)
      ? hostname.slice(0, -DEV_DOMAIN.length - 1)
      : platformLabel(hostname);
    const app = label?.match(/^\d+(?:-(.+))?$/);
    if (!app) return null;
    if (!app[1]) return "Portal";
    const key = (Object.keys(TEAM_HOST_APPS) as (keyof typeof TEAM_HOST_APPS)[]).find(
      (name) => TEAM_HOST_APPS[name] === app[1],
    );
    return key && key in portalAppLabels
      ? portalAppLabels[key as keyof typeof portalAppLabels]
      : null;
  } catch {
    return null;
  }
}

/** Above the sign-in pages: which of the team's apps they'll go back to. */
export function RedirectInfo() {
  const [searchParams] = useSearchParams();
  const names = useTeamNames();
  const redirect = searchParams.get("redirect");
  const app = redirect && appNameOf(redirect);
  if (!redirect || !app) return null;

  return (
    <div className="bg-secondary-100 text-secondary-900 px-6 py-1 text-center">
      Signing in to{" "}
      <a className="text-primary-700 underline" href={redirect}>
        {names.appTitle(app)}
      </a>
    </div>
  );
}
