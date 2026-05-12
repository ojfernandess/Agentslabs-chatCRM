import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const assetsVersion = (process.env.VITE_PUBLIC_ASSETS_VERSION ?? "").trim();

export default defineConfig({
  plugins: [
    react(),
    {
      name: "inject-favicon-cache-bust",
      transformIndexHtml(html: string) {
        if (!assetsVersion) return html;
        const q = `?v=${encodeURIComponent(assetsVersion)}`;
        return html.replace('href="/favicon.png"', `href="/favicon.png${q}"`);
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
      "/webhooks": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
