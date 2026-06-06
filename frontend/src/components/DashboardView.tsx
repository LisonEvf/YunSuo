import { InteractionProvider, AirUIComponent, useAirUIStore } from "@air-ui/renderer-react";
import { useStore } from "../store";
import { sendInteraction } from "../ws-client";
import { useEffect } from "react";

function interactionHandler(
  widgetRef: string,
  interaction: string,
  payload: Record<string, unknown>
) {
  sendInteraction(widgetRef, interaction, payload);
}

export default function DashboardView() {
  const doc = useStore((s) => s.doc);
  const setAiruiDoc = useAirUIStore((s) => s.setDoc);

  // 同步 doc 到 AIRUI 内部 store，让 AirUIComponent 的 resolveProps 能读取 state
  useEffect(() => {
    if (doc) setAiruiDoc(doc);
  }, [doc, setAiruiDoc]);

  if (!doc || !doc.root) {
    return (
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          color: "#64748b",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 500 }}>
          等待看板数据...
        </div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          连接后数据将自动显示
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
      <InteractionProvider value={interactionHandler}>
        <AirUIComponent comp={doc.root} />
      </InteractionProvider>
    </div>
  );
}
