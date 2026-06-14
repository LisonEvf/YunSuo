import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/console/",
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
      "/ws": {
        target: "http://127.0.0.1:8000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "../api/static/airui",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-markdown") || id.includes("remark-gfm") || id.includes("micromark") || id.includes("mdast")) {
            return "markdown";
          }
          if (id.includes("echarts") || id.includes("zrender")) {
            return "charts";
          }
          if (id.includes("react") || id.includes("scheduler") || id.includes("zustand")) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
});
