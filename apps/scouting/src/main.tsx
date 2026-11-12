// SPDX-License-Identifier: AGPL-3.0-only
import { QuestionProvider } from "@g3/ui";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

const DrawingPreview = import.meta.env.DEV ? lazy(() => import("./DrawingPreview")) : null;

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found.");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <QuestionProvider>
        {DrawingPreview && window.location.pathname === "/preview/drawing" ? (
          <Suspense fallback={null}>
            <DrawingPreview />
          </Suspense>
        ) : (
          <App />
        )}
      </QuestionProvider>
    </BrowserRouter>
  </StrictMode>,
);
