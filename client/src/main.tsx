import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ShortcutsProvider } from "./components/useShortcuts";
import { ThemeProvider } from "./theme/ThemeContext";
import "./index.css";

// Apenas hay una build nueva en el servidor, se recarga sola en vez de
// dejar a alguien pegado en la versión vieja hasta que cierre la pestaña
// (ver vite.config.ts). Es una herramienta interna de pocos usuarios, no
// vale la pena un prompt de "hay una versión nueva, ¿actualizar?".
const updateSW = registerSW({
  onNeedRefresh() {
    updateSW(true);
  },
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <ShortcutsProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ShortcutsProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
