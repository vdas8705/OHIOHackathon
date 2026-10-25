import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend talks to the FastAPI backend. In dev we proxy /api to :8000
// so there are no CORS surprises and the same relative paths work in prod.
// Voice model files are fetched through this same-origin proxy. Hugging Face's
// firewall sometimes answers browsers with a captcha (HTTP 405) instead of the
// files; a server-side fetch isn't challenged. Redirects (to their CDN) are
// followed on the server so the browser only ever talks to this origin.
const HF_PROXY = {
  "/hf": {
    target: "https://huggingface.co",
    changeOrigin: true,
    followRedirects: true,
    rewrite: (p: string) => p.replace(/^\/hf/, ""),
  },
};

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  // The Kokoro TTS worker dynamically imports ONNX runtime, which needs ES workers.
  worker: { format: "es" },
  // Cross-origin isolation lets the voice model's WebAssembly runtime use
  // multiple threads (much faster speech on browsers without WebGPU).
  // "require-corp" (not "credentialless") because Safari only supports this
  // one; Google Fonts and the jsDelivr runtime send the headers it needs, and
  // model files come through the same-origin /hf proxy.
  preview: { headers: ISOLATION_HEADERS, proxy: HF_PROXY },
  server: {
    headers: ISOLATION_HEADERS,
    port: 5173,
    proxy: {
      ...HF_PROXY,
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
