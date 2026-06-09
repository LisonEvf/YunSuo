import { useStore } from "../store";
import { t } from "../i18n";
import ThemeSwitcher from "./ThemeSwitcher";

export default function StatusBar() {
  const language = useStore((s) => s.appConfig.ui.language);
  const connected = useStore((s) => s.connected);
  const sessionId = useStore((s) => s.sessionId);
  const loading = useStore((s) => s.chatLoading);
  const activeTools = useStore((s) => s.activeTools);
  const doc = useStore((s) => s.doc);

  const mode = (doc as any)?.state?.mode || "general-agent";

  return (
    <footer
      className="status-bar"
      style={{
        height: 34,
        padding: "0 16px",
        background: "var(--color-surface)",
        display: "flex",
        alignItems: "center",
        gap: 18,
        fontSize: 12,
        color: "var(--color-muted)",
        borderTop: "1px solid var(--color-border)",
        flexShrink: 0,
      }}
    >
      <span style={{ color: connected ? "var(--color-success)" : "var(--color-danger)", fontWeight: 700 }}>
        {connected ? t(language, "connected") : t(language, "disconnected")}
      </span>
      <span>{t(language, "session")}: {sessionId}</span>
      <span>{t(language, "mode")}: {mode}</span>
      <span>{t(language, "run")}: {loading ? t(language, "activeRun") : t(language, "idle")}</span>
      <span>{t(language, "tools")}: {activeTools.length}</span>
      <ThemeSwitcher />
    </footer>
  );
}
