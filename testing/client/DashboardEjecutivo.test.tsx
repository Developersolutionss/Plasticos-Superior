import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardEjecutivo from "../../client/src/pages/DashboardEjecutivo";

vi.mock("../../client/src/api/client", () => ({
  api: { getDashboardResumen: vi.fn() },
}));

import { api } from "../../client/src/api/client";

const RESUMEN = {
  ventasDelMes: 1500000,
  ventasMesAnterior: 1000000,
  cambioVentasPct: 50,
  ventasUltimos6Meses: [
    { mes: "2026-03", total: 800000 },
    { mes: "2026-04", total: 900000 },
    { mes: "2026-05", total: 700000 },
    { mes: "2026-06", total: 1100000 },
    { mes: "2026-07", total: 1000000 },
    { mes: "2026-08", total: 1500000 },
  ],
  carteraPendiente: 250000,
  facturasConSaldo: 3,
  opsEnCurso: 5,
  pedidosEnProduccion: 2,
  cotizacionesAbiertas: 4,
  topClientesSaldo: [{ clientId: 1, name: "Cliente ACME", saldo: 150000 }],
};

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardEjecutivo />
    </QueryClientProvider>
  );
}

describe("DashboardEjecutivo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDashboardResumen).mockResolvedValue(RESUMEN as any);
  });

  it("muestra los KPIs principales formateados", async () => {
    renderDashboard();
    expect(await screen.findByText("$1.500.000")).toBeInTheDocument();
    expect(screen.getByText("$250.000")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("muestra la lista de clientes con mayor saldo", async () => {
    renderDashboard();
    expect(await screen.findByText("Cliente ACME")).toBeInTheDocument();
    expect(screen.getByText("$150.000")).toBeInTheDocument();
  });

  it("sin clientes con saldo muestra el estado vacío", async () => {
    vi.mocked(api.getDashboardResumen).mockResolvedValue({ ...RESUMEN, topClientesSaldo: [] } as any);
    renderDashboard();
    expect(await screen.findByText("Sin saldos pendientes.")).toBeInTheDocument();
  });
});
