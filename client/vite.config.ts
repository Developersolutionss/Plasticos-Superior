import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Se registra el service worker a mano en main.tsx (con
      // virtual:pwa-register) para poder forzar la recarga apenas hay una
      // versión nueva — el script auto-inyectado por defecto no lo hacía,
      // así que alguien con una pestaña abierta desde antes de un deploy
      // se quedaba pegado en el build viejo (JS corriendo en memoria) aunque
      // el backend ya tuviera la versión nueva.
      injectRegister: false,
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Plásticos Superior",
        short_name: "Pl. Superior",
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
