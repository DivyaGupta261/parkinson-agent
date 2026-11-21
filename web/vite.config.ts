import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the React app runs on Vite's dev server (port 5173) and the
// Python API runs on port 8000. The proxy forwards every /api request to
// FastAPI, so the browser sees one origin and no CORS setup is needed.
// In production FastAPI serves the built files from web/dist itself.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
