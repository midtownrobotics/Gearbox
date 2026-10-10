import { appUrl } from "@g3/site-config";
import { useEffect } from "react";

/** Pit's settings (its event keys and the monitor's feed) are on the team's App settings page. */
export function AdminPage() {
  useEffect(() => {
    window.location.replace(`${appUrl("portal")}/admin/settings`);
  }, []);
  return null;
}
