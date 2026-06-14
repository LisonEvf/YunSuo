import { useState, useEffect, useRef, useMemo, type FC } from "react";
import { useStore } from "../store";
import { useAirUIStore } from "@air-ui/renderer-react";
import { t } from "../i18n";
import Icon from "./Icon";

interface Command {
  id: string;
  labelKey: string;
  icon: string;
  shortcut?: string;
  action: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function patchConsoleState(delta: Record<string, unknown>) {
  const store = useAirUIStore.getState();
  if (store.doc) store.applyPatch([{ op: "update-state", stateDelta: delta }]);
}

const CommandPalette: FC<Props> = ({ open, onClose }) => {
  const language = useStore((s) => s.appConfig.ui.language);
  const setAppConfig = useStore((s) => s.setAppConfig);
  const newChatSession = useStore((s) => s.newChatSession);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: "newChat",
        labelKey: "cmdNewChat",
        icon: "plus",
        shortcut: "Ctrl+N",
        action: () => { newChatSession(); onClose(); },
      },
      {
        id: "toggleChat",
        labelKey: "cmdToggleChat",
        icon: "chat",
        shortcut: "Ctrl+B",
        action: () => {
          const cfg = useStore.getState().appConfig;
          setAppConfig({ ui: { ...cfg.ui, chatCollapsed: !cfg.ui.chatCollapsed } });
          onClose();
        },
      },
      {
        id: "toggleTheme",
        labelKey: "cmdToggleTheme",
        icon: "palette",
        action: () => {
          const themes = ["light", "dark", "graphite", "neon", "glass", "system"] as const;
          const cfg = useStore.getState().appConfig;
          const idx = themes.indexOf(cfg.ui.theme);
          const next = themes[(idx + 1) % themes.length];
          setAppConfig({ ui: { ...cfg.ui, theme: next } });
          onClose();
        },
      },
      {
        id: "focusInput",
        labelKey: "cmdFocusInput",
        icon: "messageSquare",
        shortcut: "Ctrl+K",
        action: () => {
          const fn = (window as any).__focusChatInput;
          if (typeof fn === "function") fn();
          onClose();
        },
      },
      {
        id: "goHome",
        labelKey: "cmdGoHome",
        icon: "home",
        action: () => {
          patchConsoleState({ homePinned: true, artifacts: [], wikiOpen: false, wikiCategory: "", settingsOpen: false, mainVisible: true });
          onClose();
        },
      },
      {
        id: "openSettings",
        labelKey: "cmdOpenSettings",
        icon: "settings",
        action: () => {
          patchConsoleState({ settingsOpen: true, mainVisible: false });
          onClose();
        },
      },
    ];
    return cmds;
  }, [newChatSession, setAppConfig, onClose]);

  const filtered = commands.filter((cmd) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    const label = t(language, cmd.labelKey).toLowerCase();
    return label.includes(q) || cmd.id.toLowerCase().includes(q);
  });

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[selectedIdx];
        if (cmd) cmd.action();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, selectedIdx, onClose]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  if (!open) return null;

  return (
    <div className="cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-palette-header">
          <Icon name="sparkles" size={16} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(language, "commandPalette")}
            className="cmd-palette-input"
          />
          <button className="cmd-palette-close" onClick={onClose} aria-label={t(language, "cancel")}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div ref={listRef} className="cmd-palette-list">
          {filtered.length === 0 && (
            <div className="cmd-palette-empty">{t(language, "noResults")}</div>
          )}
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`cmd-palette-item ${i === selectedIdx ? "cmd-palette-item-active" : ""}`}
              onClick={() => cmd.action()}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <Icon name={cmd.icon as any} size={16} />
              <span className="cmd-palette-label">{t(language, cmd.labelKey)}</span>
              {cmd.shortcut && <kbd className="cmd-palette-shortcut">{cmd.shortcut}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
