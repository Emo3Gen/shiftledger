import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      "/debug": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/events": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});

