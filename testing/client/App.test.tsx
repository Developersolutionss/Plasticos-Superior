import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../../client/src/App";
import { AuthProvider } from "../../client/src/auth/AuthContext";

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
        <MemoryRouter initialEntries={[initialPath]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.login).mockResolvedValue({
      token: "test-token",
      user: { id: 1, name: "Admin", role: "admin", email: "admin@empresa.com" },
    });
  });

  it("redirige a /login cuando no hay sesión", () => {
    renderApp("/");
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeInTheDocument();
  });

  it("renderiza la página de login con valores por defecto", () => {
    renderApp("/login");
    expect(screen.getByText("Inventario y Despachos")).toBeInTheDocument();
    expect(screen.getByDisplayValue("despacho@empresa.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("password123")).toBeInTheDocument();
  });

  it("inicia sesión y navega al layout con el usuario logueado", async () => {
    const user = userEvent.setup();
    renderApp("/login");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByRole("button", { name: "Salir" })).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(api.login).toHaveBeenCalledWith("despacho@empresa.com", "password123");
  });
});
