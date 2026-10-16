import { QuestionProvider } from "@g3/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found.");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <QuestionProvider>
        <App />
      </QuestionProvider>
    </BrowserRouter>
  </StrictMode>,
);
