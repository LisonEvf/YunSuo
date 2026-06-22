import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/console/",
  plugins: [react()],
  server: {
    // Disable all caching in dev mode so HMR always serves fresh modules.
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
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
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Charts: separate lazy-loaded chunk (only loaded when a Chart renders)
          if (id.includes("echarts") || id.includes("zrender")) {
            return "charts";
          }
          // All other node_modules go into vendor (react, markdown, zustand, etc.)
          // Merging react into vendor avoids circular chunk dependencies
          return "vendor";
        },
      },
    },
  },
});