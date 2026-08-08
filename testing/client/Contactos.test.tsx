import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Contactos from "../../client/src/pages/Contactos";

vi.mock("../../client/src/api/client", () => ({
  api: {
    getAllContacts: vi.fn(),
    getClients: vi.fn().mockResolvedValue([]),
    recordContactVisit: vi.fn().mockResolvedValue({ viewCount: 1, lastViewedAt: new Date().toISOString(), cycleInteractions: 1 }),
    deleteClientContact: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { api } from "../../client/src/api/client";

const CONTACTS = [
  {
    id: 1,
    name: "Ana López",
    clientId: 10,
    position: "Compras",
    phone: "311-555-0100",
    email: "ana@empresa.com",
    isPrimary: true,
    createdAt: "2026-01-10T00:00:00Z",
    viewCount: 3,
    cycleInteractions: 2,
    client: { id: 10, name: "Plastinor", avatarUrl: null },
  },
];

function renderContactos() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/clientes/contactos"]}>
        <Contactos />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Contactos · modal y menú ⋮", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getAllContacts).mockResolvedValue(CONTACTS);
  });

  it("'Esc' cierra el modal de contacto", async () => {
    const user = userEvent.setup();
    renderContactos();
    await user.click(await screen.findByText("Ana López"));
    expect(screen.getByText("Cargo")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Cargo")).not.toBeInTheDocument();
  });

  it("'Esc' cierra el menú ⋮ de opciones", async () => {
    const user = userEvent.setup();
    renderContactos();
    await user.click(await screen.findByRole("button", { name: /Opciones de Ana López/i }));
    expect(screen.getByText("Abrir empresa")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Abrir empresa")).not.toBeInTheDocument();
  });
});
