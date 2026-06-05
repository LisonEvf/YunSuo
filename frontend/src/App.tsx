import React, { useEffect } from "react";
import { connectWebSocket, disconnectWebSocket } from "./ws-client";
import DashboardView from "./components/DashboardView";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";

export default function App() {
  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#0f172a",
        color: "#e2e8f0",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <ChatPanel />
        <DashboardView />
      </div>
      <StatusBar />
    </div>
  );
}
