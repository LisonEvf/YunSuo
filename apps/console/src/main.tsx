import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@air-ui/renderer-react/theme.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for PWA offline support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/console/sw.js").catch(() => {});
  });
}
