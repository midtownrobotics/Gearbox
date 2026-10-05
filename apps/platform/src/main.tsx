import { CONSOLE_HOSTS } from "@g3/site-config";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { LogPage } from "./console/log-page";
import { OperatorsPage } from "./console/operators-page";
import { ReportsPage } from "./console/reports-page";
import { ConsoleShell } from "./console/shell";
import { TeamPage } from "./console/team-page";
import { TeamsPage } from "./console/teams-page";
import { HomePage } from "./home-page";
import { ReportPage } from "./report-page";
import { SignupPage } from "./signup-page";

/** admin.<domain> is only the operators' console (also at /console on the platform's own host). */
const onConsoleHost = (CONSOLE_HOSTS as readonly string[]).includes(window.location.hostname);

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
          <Route path="operators" element={<OperatorsPage />} />
          <Route path="log" element={<LogPage />} />
        </Route>
        {onConsoleHost ? (
          <Route path="*" element={<Navigate to="/console" replace />} />
        ) : (
          <>
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="*" element={<HomePage />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
