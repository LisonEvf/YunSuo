import { InteractionProvider, AirUIComponent } from "@air-ui/renderer-react";
import { useStore } from "../store";
import { sendInteraction } from "../ws-client";

function interactionHandler(
  widgetRef: string,
  interaction: string,
  payload: Record<string, unknown>
) {
  sendInteraction(widgetRef, interaction, payload);
}

export default function DashboardView() {
  const doc = useStore((s) => s.doc);

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
