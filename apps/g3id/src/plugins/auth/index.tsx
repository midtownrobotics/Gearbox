import { MovedToHome } from "../../shared/moved-to-home";
import type { Plugin } from "../../shared/plugin-types";
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
    { path: "/login/email", element: <EmailLoginPage /> },
    { path: "/login/error", element: <OAuthErrorPage /> },
    { path: "/login/slack", element: <SlackLoginPage /> },
    { path: "/signup", element: <SignupPage /> },
    { path: "/signup/pending", element: <PendingPage /> },
    { path: "/", element: <MovedToHome /> },
    { path: "/dashboard", element: <MovedToHome /> },
    { path: "/leaderboard", element: <MovedToHome /> },
  ],
  navItems: [
    { label: "Sign in", to: "/login", order: 0, audience: "signed-out" },
    { label: "Sign up", to: "/signup", order: 1, audience: "signed-out" },
  ],
};
