import React from "react";
import ReactDOM from "react-dom/client";
import ModernDashboardApp from "./ModernDashboardApp";
import "./styles.css";
import "./guide.css";
import "./modern.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ModernDashboardApp />
  </React.StrictMode>
);
