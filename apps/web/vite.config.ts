import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { copyFileSync, existsSync } from "fs";

const assetsVersion = (process.env.VITE_PUBLIC_ASSETS_VERSION ?? "").trim();

function syncRootLogoToPublic() {
  const rootLogo = path.resolve(__dirname, "../../logo.svg");
  const publicLogo = path.resolve(__dirname, "public/logo.svg");
  if (existsSync(rootLogo)) {
    copyFileSync(rootLogo, publicLogo);
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "sync-root-logo",
      buildStart() {
        syncRootLogoToPublic();
      },
      configureServer() {
        syncRootLogoToPublic();
      },
    },
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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          motion: ["framer-motion"],
          dates: ["date-fns"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
