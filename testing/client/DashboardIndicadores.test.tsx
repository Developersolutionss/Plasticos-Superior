import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("cambiar el rango y aplicar vuelve a pedir con las fechas nuevas", async () => {
    vi.mocked(api.getDashboardIndicadores).mockResolvedValue({
      topProductosDespachados: [],
      calidad: { aprobadas: 0, rechazadas: 0, pctAprobacion: null },
      tiempoPromedioProduccionHoras: null,
    } as any);

    const user = userEvent.setup();
    renderIndicadores();
    await screen.findByText("Sin despachos en el período.");
    vi.mocked(api.getDashboardIndicadores).mockClear();

    const [desde, hasta] = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/) as HTMLInputElement[];
    await user.clear(desde);
    await user.type(desde, "2025-12-01");
    await user.clear(hasta);
    await user.type(hasta, "2025-12-31");
    await user.click(screen.getByText("Aplicar"));

    expect(api.getDashboardIndicadores).toHaveBeenCalledWith({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("cambiar las fechas sin aplicar no dispara un nuevo pedido", async () => {
    vi.mocked(api.getDashboardIndicadores).mockResolvedValue({
      topProductosDespachados: [],
      calidad: { aprobadas: 0, rechazadas: 0, pctAprobacion: null },
      tiempoPromedioProduccionHoras: null,
    } as any);

    const user = userEvent.setup();
    renderIndicadores();
    await screen.findByText("Sin despachos en el período.");
    vi.mocked(api.getDashboardIndicadores).mockClear();

    const [desde] = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/) as HTMLInputElement[];
    await user.clear(desde);
    await user.type(desde, "2025-12-01");

    expect(api.getDashboardIndicadores).not.toHaveBeenCalled();
  });
});
