import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Inventario y Despachos",
        short_name: "Inventario",
        description: "Control de inventario, producción y despachos en tiempo real",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml" }],
      },
      workbox: {
        // El dashboard de stock se sirve stale-while-revalidate para que
        // siga siendo legible con conectividad intermitente en planta;
        // las mutaciones (POST/PATCH) nunca se cachean.
        runtimeCaching: [
          {
            urlPattern: /\/api\/inventory/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "inventory-cache" },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
