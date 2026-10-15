import { Moved } from "../../shared/moved";
import type { Plugin } from "../../shared/plugin-types";
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
    // ID only signs people in: the account page is on the team's home now.
    { path: "/dashboard", element: <Moved app="portal" to="/account" /> },
    // Moved to Attendance.
    { path: "/leaderboard", element: <Moved app="attendance" to="/leaderboard" /> },
    { path: "/", element: <Moved app="portal" to="/" /> },
  ],
  navItems: [
    { label: "Sign in", to: "/login", order: 2, audience: "signed-out" },
    { label: "Sign up", to: "/signup", order: 3, audience: "signed-out" },
  ],
};
