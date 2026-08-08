import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const assetsVersion = (process.env.VITE_PUBLIC_ASSETS_VERSION ?? "").trim();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function syncBrandLogoToPublic() {
  const sources = [
    path.join(repoRoot, "automation/logo.svg"),
    path.join(repoRoot, "logo.svg"),
  ];
  const src = sources.find((p) => existsSync(p));
  const publicLogo = path.resolve(__dirname, "public/logo.svg");
  if (src) {
    copyFileSync(src, publicLogo);
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "sync-root-logo",
      buildStart() {
        syncBrandLogoToPublic();
      },
      configureServer() {
        syncBrandLogoToPublic();
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
