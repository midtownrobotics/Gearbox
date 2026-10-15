import { pageTeamNumber, platformUrl } from "@g3/site-config";
import { useTeamUiSettings } from "@g3/ui";

/**
 * Under the sign-in pages: someone who landed on another team's sign-in (each team signs in on its
 * own address) finds theirs on the platform's team finder.
 */
export function NotYourTeam() {
  return (
    <p className="text-center text-sm text-secondary-500">
      Not team {pageTeamNumber}?{" "}
      <a
        href={`${platformUrl}/team`}
        className="font-medium text-primary-500 hover:text-primary-600 transition-colors"
      >
        Find your team
      </a>
    </p>
  );
}

/** The team's public site, for visitors who aren't members: hidden when the team has none. */
export function PublicSiteLink() {
  const teamUi = useTeamUiSettings();
  const url = teamUi.links.publicSite;
  if (!url || teamUi.hiddenLinks?.includes("publicSite")) return null;
  return (
    <p className="text-center text-sm text-secondary-500">
      Not a member?{" "}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-primary-500 hover:text-primary-600 transition-colors"
      >
        Visit the team's site
      </a>
    </p>
  );
}
