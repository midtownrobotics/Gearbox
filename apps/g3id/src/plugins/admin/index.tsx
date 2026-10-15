import { useParams } from "react-router-dom";
import { Moved } from "../../shared/moved";
import type { Plugin } from "../../shared/plugin-types";

/** A member's page, now on the team's home. */
function MemberMoved() {
  const { id = "" } = useParams();
  return <Moved app="portal" to={`/admin/members/${encodeURIComponent(id)}`} />;
}

// ID only signs people in (decided 15 October): its admin pages moved to the team's home, and
// old links go there.
export const adminPlugin: Plugin = {
  name: "admin",
  routes: [
    { path: "/admin/users", element: <Moved app="portal" to="/admin/members" /> },
    { path: "/admin/users/:id", element: <MemberMoved /> },
    { path: "/admin/kiosk", element: <Moved app="portal" to="/admin/kiosks" /> },
    { path: "/admin/slack", element: <Moved app="portal" to="/admin/integrations" /> },
    { path: "/admin/team-ui", element: <Moved app="portal" to="/admin/appearance" /> },
    { path: "/admin/attendance", element: <Moved app="attendance" to="/admin" /> },
  ],
};
