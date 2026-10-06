import { appVersion } from "@g3/site-config/versions";

/** The app's version (from package.json, shared with its worker), bottom right on every page. */
export function VersionFooter() {
  return (
    <div className="fixed bottom-4 right-4 text-xs text-secondary-500 opacity-60 pointer-events-none">
      v{appVersion}
    </div>
  );
}
