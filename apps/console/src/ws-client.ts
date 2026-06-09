import { useStore } from "./store";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket() {
  const host = window.location.host;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const sessionId = useStore.getState().sessionId;

  if (reconnectTimer) clearTimeout(reconnectTimer);

  const isDev = import.meta.env.DEV;
  const wsUrl = isDev
    ? `ws://127.0.0.1:8000/ws/airui?session=${sessionId}`
    : `${protocol}//${host}/ws/airui?session=${sessionId}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    useStore.getState().setConnected(true);
  };

  ws.onclose = () => {
    useStore.getState().setConnected(false);
    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      switch (msg.type) {
        case "document":
          useStore.getState().setDoc(msg.data);
          if (msg.title) document.title = msg.title;
          break;
        case "patch":
          useStore.getState().applyPatch(msg.data);
          break;
        case "session":
          useStore.getState().setSessionId(msg.sessionId);
          break;
      }
    } catch {
      // ignore
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function sendInteraction(
  widgetRef: string,
  interaction: string,
  payload: Record<string, unknown> = {}
) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({ type: "interaction", widgetRef, interaction, payload })
    );
  }
}

export function disconnectWebSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
}
