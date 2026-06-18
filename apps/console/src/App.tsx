import { useEffect, useState, useCallback } from "react";
import { connectWebSocket, disconnectWebSocket } from "./ws-client";
import ConsoleView from "./components/ConsoleView";
import ChatPanel from "./components/ChatPanel";
import McpToolForm from "./components/McpToolForm";
import StatusBar from "./components/StatusBar";
import ToastContainer from "./components/Toast";
import CommandPalette from "./components/CommandPalette";
import { useStore } from "./store";
import { t } from "./i18n";
import { CUSTOM_THEMES_KEY, loadCustomThemes, applyCustomThemes } from "./themes";

export default function App() {
  const theme = useStore((s) => s.appConfig.ui.theme);
  const language = useStore((s) => s.appConfig.ui.language);
  const appConfig = useStore((s) => s.appConfig);
  const setAppConfig = useStore((s) => s.setAppConfig);
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  useEffect(() => {
    connectWebSocket();
    useStore.getState().initChatHistory();
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

  useEffect(() => {
    applyCustomThemes(loadCustomThemes());
    const onStorage = (event: StorageEvent) => {
      if (event.key === CUSTOM_THEMES_KEY) applyCustomThemes(loadCustomThemes());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Global keyboard shortcuts
  const toggleChat = useCallback(() => {
    const cfg = useStore.getState().appConfig;
    const next = !cfg.ui.chatCollapsed;
    setAppConfig({ ui: { ...cfg.ui, chatCollapsed: next } });
    // Persist
    fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { ...useStore.getState().appConfig, ui: { ...cfg.ui, chatCollapsed: next } } }),
    }).catch(() => {});
  }, [setAppConfig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

      // Ctrl/Cmd + B: toggle chat panel
      if ((e.ctrlKey || e.metaKey) && e.key === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleChat();
        return;
      }

      // Ctrl/Cmd + K: open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowCommandPalette(true);
        return;
      }

      // Escape: close MCP tool form if open
      if (e.key === "Escape" && !inField) {
        const store = useStore.getState();
        if (store.mcpToolForm) {
          store.setMcpToolForm(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleChat]);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">{t(language, "skipToContent")}</a>
      <div className="app-main">
        <ChatPanel />
        <main id="main-content">
          <ConsoleView />
        </main>
      </div>
      <StatusBar />
      <McpToolForm />
      <ToastContainer />
      <CommandPalette open={showCommandPalette} onClose={() => setShowCommandPalette(false)} />
    </div>
  );
}
