import { CONSOLE_HOSTS, DOCS_HOSTS } from "@g3/site-config";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { LogPage } from "./console/log-page";
import { NotificationsPage } from "./console/notifications-page";
import { OperatorsPage } from "./console/operators-page";
import { ReportsPage } from "./console/reports-page";
import { ConsoleShell } from "./console/shell";
import { TeamPage } from "./console/team-page";
import { TeamsPage } from "./console/teams-page";
import { VisitsPage } from "./console/visits-page";
import { HomePage } from "./home-page";
import { ReportPage } from "./report-page";
import { SignupPage } from "./signup-page";
import { MyTeamPage, NotFoundPage, TeamNotFoundPage } from "./team-pages";

/** admin.<domain> is only the operators' console (also at /console on the platform's own host). */
const onConsoleHost = (CONSOLE_HOSTS as readonly string[]).includes(window.location.hostname);

/** docs.<domain> is only the docs (also at /docs on the platform's own host). */
const onDocsHost = (DOCS_HOSTS as readonly string[]).includes(window.location.hostname);

// The docs are their own chunk: the landing page doesn't load them.
const DocsApp = lazy(() => import("./docs/docs-app"));
const docs = (base: string) => (
  <Suspense fallback={<div className="min-h-screen bg-page" />}>
    <DocsApp base={base} />
  </Suspense>
);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/console" element={<ConsoleShell />}>
          <Route index element={<TeamsPage />} />
          <Route path="teams/:id" element={<TeamPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="visitors" element={<VisitsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="operators" element={<OperatorsPage />} />
          <Route path="log" element={<LogPage />} />
        </Route>
        {onConsoleHost ? (
          <Route path="*" element={<Navigate to="/console" replace />} />
        ) : onDocsHost ? (
          <Route path="*" element={docs("")} />
        ) : (
          <>
            <Route path="/docs/*" element={docs("/docs")} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/team" element={<MyTeamPage />} />
            <Route path="/team-not-found" element={<TeamNotFoundPage />} />
            <Route path="/not-found" element={<NotFoundPage />} />
            <Route path="*" element={<HomePage />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
