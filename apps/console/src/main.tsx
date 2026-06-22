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

// Aggressively unregister ALL service workers on every load. The old
// cache-first SW caused stale-content bugs (hard refresh = fresh,
// normal refresh = stale). Rather than try to update it, we purge it
// completely. The new sw.js is self-uninstalling, so even if it gets
// registered, it cleans up after itself. This runs in BOTH dev and prod.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => {
        if (registrations.length > 0) {
          // Unregister all existing SWs so they stop controlling the page.
          return Promise.all(registrations.map((reg) => reg.unregister()));
        }
        return [];
      })
      .then((unregistered) => {
        if (unregistered.length > 0) {
          // Clear all caches left behind by old SWs.
          if ("caches" in window) {
            caches.keys().then((keys) =>
              Promise.all(keys.map((key) => caches.delete(key)))
            );
          }
          // Reload once to ensure the page is no longer controlled by a SW.
          window.location.reload();
        }
      })
      .catch(() => {});
  });
}