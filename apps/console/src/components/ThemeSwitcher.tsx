import { useStore, type ThemeMode } from "../store";
import { t } from "../i18n";

const THEMES: Array<{ value: ThemeMode; swatch: string; ring: string }> = [
  { value: "light", swatch: "linear-gradient(135deg, #f6f9fc 45%, #635bff 45%)", ring: "#635bff" },
  { value: "dark", swatch: "linear-gradient(135deg, #06182e 45%, #7a73ff 45%)", ring: "#7a73ff" },
  { value: "graphite", swatch: "linear-gradient(135deg, #eceff3 45%, #5352ed 45%)", ring: "#5352ed" },
  { value: "neon", swatch: "linear-gradient(135deg, #06070f 45%, #00d9ff 45%)", ring: "#00d9ff" },
  { value: "glass", swatch: "linear-gradient(135deg, #c9d6ff, #e0d4ff 50%, #ffd9ec)", ring: "#635bff" },
  { value: "system", swatch: "linear-gradient(135deg, #f6f9fc 50%, #06182e 50%)", ring: "#425466" },
];

export default function ThemeSwitcher() {
  const current = useStore((s) => s.appConfig.ui.theme);
  const language = useStore((s) => s.appConfig.ui.language);
  const setAppConfig = useStore((s) => s.setAppConfig);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
      {THEMES.map((th) => {
        const active = current === th.value;
        return (
          <button
            key={th.value}
            type="button"
            title={t(language, th.value)}
            aria-label={t(language, th.value)}
            onClick={() => setAppConfig({ ui: { theme: th.value, language } })}
            style={{
              width: 18,
              height: 18,
              padding: 0,
              borderRadius: "50%",
              border: "none",
              background: th.swatch,
              cursor: "pointer",
              boxShadow: active
                ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${th.ring}`
                : "0 0 0 1px var(--color-border)",
              transform: active ? "scale(1.12)" : "scale(1)",
              transition: "transform 0.12s ease, box-shadow 0.12s ease",
            }}
          />
        );
      })}
    </div>
  );
}
