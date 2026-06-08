import { useEffect } from "react";
import { connectWebSocket, disconnectWebSocket } from "./ws-client";
import ConsoleView from "./components/ConsoleView";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";
import { useStore } from "./store";

export default function App() {
  const theme = useStore((s) => s.appConfig.ui.theme);

  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
    };

    applyTheme();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  return (
    <div
      className="app-shell"
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-app-bg)",
        color: "var(--color-text)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div className="app-main" style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <ChatPanel />
        <ConsoleView />
      </div>
      <StatusBar />
    </div>
  );
}
