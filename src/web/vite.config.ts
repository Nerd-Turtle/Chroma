import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webDistDir = process.env.CHROMA_WEB_DIST_DIR;

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:3000",
    // Preserve the browser's Host for the API's exact Origin check during development.
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: webDistDir ?? "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    proxy: apiProxy,
  },
  preview: {
    host: "127.0.0.1",
    proxy: apiProxy,
  },
});
