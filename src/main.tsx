import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./vendor/cs16.css";
import "./theme.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
