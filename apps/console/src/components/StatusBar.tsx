import { useStore } from "../store";
import { t } from "../i18n";
import ThemeSwitcher from "./ThemeSwitcher";
import Icon from "./Icon";

export default function StatusBar() {
  const language = useStore((s) => s.appConfig.ui.language);
  const connected = useStore((s) => s.connected);
  const sessionId = useStore((s) => s.sessionId);
  const loading = useStore((s) => s.chatLoading);
  const activeTools = useStore((s) => s.activeTools);
  const doc = useStore((s) => s.doc);

  const modeKey = (doc as any)?.state?.mode || "general-agent";
  const modeLabelMap: Record<string, string> = {
    "general-agent": t(language, "modeGeneralAgent"),
  };
  const modeLabel = modeLabelMap[modeKey] ?? modeKey;

  return (
    <footer className="status-bar">
      <span className={`status-conn ${connected ? "status-conn-on" : "status-conn-off"}`}>
        <Icon name={connected ? "connected" : "disconnected"} size={13} />
        <span>{connected ? t(language, "connected") : t(language, "disconnected")}</span>
      </span>
      <span className="status-item">{t(language, "session")}: {sessionId}</span>
      <span className="status-item">{t(language, "mode")}: {modeLabel}</span>
      <span className={`status-item ${loading ? "status-running" : ""}`}>
        {t(language, "run")}: {loading ? t(language, "activeRun") : t(language, "idle")}
      </span>
      <span className="status-item">{t(language, "tools")}: {activeTools.length}</span>
      <ThemeSwitcher />
    </footer>
  );
}
