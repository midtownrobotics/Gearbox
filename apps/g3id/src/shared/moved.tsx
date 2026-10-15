import { type AppName, appUrl } from "@g3/site-config";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/** A page that moved to another app (the team's admin pages on its home, Attendance): old links go there. */
export function Moved({ app, to }: { app: AppName; to: string }) {
  const { search } = useLocation();
  useEffect(() => {
    window.location.replace(`${appUrl(app)}${to}${search}`);
  }, [app, to, search]);
  return null;
}
