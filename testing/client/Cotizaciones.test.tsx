import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Cotizaciones from "../../client/src/pages/Cotizaciones";

vi.mock("../../client/src/api/client", () => ({
  api: {
    getClients: vi.fn(),
    getProducts: vi.fn().mockResolvedValue([]),
    getCotizaciones: vi.fn().mockResolvedValue([]),
    createCotizacion: vi.fn(),
    downloadCotizacionPdf: vi.fn().mockResolvedValue(undefined),
  },
}));

import { api } from "../../client/src/api/client";

const CLIENTS = [
  { id: 1, name: "Alfa", viewCount: 10, lastViewedAt: "2026-08-01T00:00:00Z", avatarUrl: null },
  { id: 2, name: "Bravo", viewCount: 9, lastViewedAt: "2026-08-07T00:00:00Z", avatarUrl: "http://x/bravo.png" },
];

function renderCotizaciones(state?: { clientId?: number }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entry = state ? { pathname: "/clientes/cotizaciones", state } : "/clientes/cotizaciones";
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry as any]}>
        <Cotizaciones />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Cotizaciones · preselección desde el botón Cotizar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getClients).mockResolvedValue(CLIENTS);
  });

  it("llega con el cliente ya seleccionado cuando navega con state.clientId", async () => {
    renderCotizaciones({ clientId: 2 });
    expect(await screen.findByAltText("Bravo")).toBeInTheDocument();
    expect(screen.getByLabelText("Quitar cliente")).toBeInTheDocument();
  });

  it("sin state no preselecciona ningún cliente", async () => {
    renderCotizaciones();
    await screen.findByLabelText("Buscar cliente");
    expect(screen.queryByLabelText("Quitar cliente")).not.toBeInTheDocument();
  });
});

describe("Cotizaciones · descarga de PDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getClients).mockResolvedValue(CLIENTS);
    vi.mocked(api.getCotizaciones).mockResolvedValue([
      {
        id: 1,
        quoteNumber: "COT-00001",
        status: "borrador",
        validUntil: null,
        client: { id: 1, name: "Alfa" },
        items: [{ quantity: 2, unitPrice: 5000 }],
      },
    ] as any);
  });

  it("el botón PDF descarga la cotización con su número", async () => {
    const user = userEvent.setup();
    renderCotizaciones();
    await user.click(await screen.findByText("PDF"));
    expect(api.downloadCotizacionPdf).toHaveBeenCalledWith(1, "COT-00001");
  });
});