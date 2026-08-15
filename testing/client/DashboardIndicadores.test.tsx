import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardIndicadores from "../../client/src/pages/DashboardIndicadores";

vi.mock("../../client/src/api/client", () => ({
  api: { getDashboardIndicadores: vi.fn() },
}));

import { api } from "../../client/src/api/client";

function renderIndicadores() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardIndicadores />
    </QueryClientProvider>
  );
}

describe("DashboardIndicadores", () => {
  beforeEach(() => vi.clearAllMocks());

  it("muestra la tasa de aprobación y el tiempo promedio de producción", async () => {
    vi.mocked(api.getDashboardIndicadores).mockResolvedValue({
      topProductosDespachados: [{ productId: 1, sku: "BUL-001", name: "Bulto", unit: "kg", total: 300 }],
      calidad: { aprobadas: 8, rechazadas: 2, pctAprobacion: 80 },
      tiempoPromedioProduccionHoras: 5.5,
    } as any);

    renderIndicadores();
    expect(await screen.findByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5.5 hs")).toBeInTheDocument();
  });

  it("sin checks de calidad todavía, muestra guiones en vez de dividir por cero", async () => {
    vi.mocked(api.getDashboardIndicadores).mockResolvedValue({
      topProductosDespachados: [],
      calidad: { aprobadas: 0, rechazadas: 0, pctAprobacion: null },
      tiempoPromedioProduccionHoras: null,
    } as any);

    renderIndicadores();
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBe(2);
    expect(screen.getByText("Sin despachos en el período.")).toBeInTheDocument();
  });
});
