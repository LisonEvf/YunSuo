import React from "react";
import { useStore } from "../store";

export default function StatusBar() {
  const connected = useStore((s) => s.connected);
  const sessionId = useStore((s) => s.sessionId);
  const doc = useStore((s) => s.doc);

  const day = (doc as any)?.state?.day || "--";

  return (
    <div
      style={{
        height: 32,
        padding: "0 16px",
        background: "#0f172a",
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontSize: 12,
        color: "#64748b",
        borderTop: "1px solid #1e293b",
      }}
    >
      <span style={{ color: connected ? "#22c55e" : "#ef4444" }}>
        ● {connected ? "已连接" : "未连接"}
      </span>
      <span>Session: {sessionId}</span>
      <span>交易日: {day}</span>
    </div>
  );
}
