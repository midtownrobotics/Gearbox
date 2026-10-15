import { Moved } from "../../shared/moved";
import type { Plugin } from "../../shared/plugin-types";
import { DashboardPage } from "./dashboard-page";
import { DemoPage } from "./demo-page";
import { EmailLoginPage } from "./email-login-page";
import { LoginPage } from "./login-page";
import { OAuthErrorPage } from "./oauth-error-page";
import { PendingPage } from "./pending-page";
import { SignupPage } from "./signup-page";
import { SlackLoginPage } from "./slack-login-page";

export const authPlugin: Plugin = {
  name: "auth",
  routes: [
    { path: "/login", element: <LoginPage /> },
    { path: "/demo", element: <DemoPage /> },
    { path: "/login/email", element: <EmailLoginPage /> },
    { path: "/login/error", element: <OAuthErrorPage /> },
    { path: "/login/slack", element: <SlackLoginPage /> },
    { path: "/signup", element: <SignupPage /> },
    { path: "/signup/pending", element: <PendingPage /> },
    { path: "/dashboard", element: <DashboardPage /> },
    // Moved to Attendance.
    { path: "/leaderboard", element: <Moved app="attendance" to="/leaderboard" /> },
    { path: "/", element: <DashboardPage /> },
  ],
  navItems: [
    { label: "Account", to: "/", order: 0 },
    { label: "Sign in", to: "/login", order: 2, audience: "signed-out" },
    { label: "Sign up", to: "/signup", order: 3, audience: "signed-out" },
  ],
};
