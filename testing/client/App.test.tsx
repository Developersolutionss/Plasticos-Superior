import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../../client/src/App";
import { AuthProvider } from "../../client/src/auth/AuthContext";
import { ShortcutsProvider } from "../../client/src/components/useShortcuts";
import { ThemeProvider } from "../../client/src/theme/ThemeContext";

vi.mock("../../client/src/api/client", () => ({
  api: {
    login: vi.fn(),
    getInventory: vi.fn().mockResolvedValue([]),
    getAlerts: vi.fn().mockResolvedValue([]),
    getProducts: vi.fn().mockResolvedValue([]),
    getClients: vi.fn().mockResolvedValue([]),
    createClient: vi.fn(),
    createProductionEntry: vi.fn(),
    previewImport: vi.fn(),
    confirmImport: vi.fn(),
    getDispatches: vi.fn().mockResolvedValue([]),
    createDispatch: vi.fn(),
    markItemDispatched: vi.fn(),
  },
}));

import { api } from "../../client/src/api/client";

function renderApp(initialPath = "/login") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <ShortcutsProvider>
            <MemoryRouter initialEntries={[initialPath]}>
              <App />
            </MemoryRouter>
          </ShortcutsProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.login).mockResolvedValue({
      token: "test-token",
      user: { id: 1, name: "Admin", role: "super_admin", email: "admin@empresa.com", twoFactorEnabled: false },
    });
  });

  it("redirige a /login cuando no hay sesión", () => {
    renderApp("/");
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeInTheDocument();
  });

  it("renderiza la página de login con los campos vacíos", () => {
    renderApp("/login");
    // El logo aparece dos veces en el DOM (panel de marca de escritorio +
    // versión mobile arriba del form) -- cuál se ve depende de un breakpoint
    // CSS que jsdom no evalúa, así que las dos están "presentes" para
    // testing-library aunque en un navegador real solo se vea una.
    expect(screen.getAllByAltText("Plásticos Superior San Judas S.A.S.").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Email")).toHaveValue("");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
  });

  it("inicia sesión, muestra la transición de bienvenida y navega al layout", async () => {
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(screen.getByLabelText("Email"), "despacho@empresa.com");
    await user.type(screen.getByLabelText("Contraseña"), "password123");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    // Antes de llegar al layout se ve la pantalla de transición ("Bienvenido,
    // <nombre>") -- login() ya corrió (la sesión existe) pero la navegación
    // a "/" se demora un momento a propósito, no es instantánea.
    expect(await screen.findByText("Bienvenido, Admin")).toBeInTheDocument();

    // La navegación real tarda ~1.6s (ver setTimeout en Login.tsx) -- se le
    // da margen de sobra al timeout default de findBy (1s) para no volverse
    // un test flaky.
    expect(await screen.findByRole("button", { name: "Salir" }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith("despacho@empresa.com", "password123", undefined);
  });
});
