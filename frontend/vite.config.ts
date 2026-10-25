import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend talks to the FastAPI backend. In dev we proxy /api to :8000
// so there are no CORS surprises and the same relative paths work in prod.
export default defineConfig({
  plugins: [react()],
  // The Kokoro TTS worker dynamically imports ONNX runtime, which needs ES workers.
  worker: { format: "es" },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
