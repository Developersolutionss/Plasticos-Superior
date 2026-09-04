import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import DashboardEjecutivo from "../../client/src/pages/DashboardEjecutivo";
import { AuthProvider } from "../../client/src/auth/AuthContext";
import { ThemeProvider } from "../../client/src/theme/ThemeContext";

vi.mock("../../client/src/api/client", () => ({
  api: { getDashboardResumen: vi.fn() },
}));

import { api } from "../../client/src/api/client";

const RESUMEN = {
  period: "mes",
  ventasDelPeriodo: 1500000,
  ventasPeriodoAnterior: 1000000,
  cambioVentasPct: 50,
  kgProducidosDelPeriodo: 4200,
  kgProducidosPeriodoAnterior: 3800,
  ventasUltimos6Meses: [
    { mes: "2026-03", total: 800000, kg: 3000 },
    { mes: "2026-04", total: 900000, kg: 3200 },
    { mes: "2026-05", total: 700000, kg: 2800 },
    { mes: "2026-06", total: 1100000, kg: 3900 },
    { mes: "2026-07", total: 1000000, kg: 3800 },
    { mes: "2026-08", total: 1500000, kg: 4200 },
  ],
  carteraPendiente: 250000,
  carteraVencida: 90000,
  facturasConSaldo: 3,
  opsEnCurso: 5,
  pedidosEnProduccion: 2,
  cotizacionesAbiertas: 4,
  valorCotizacionesAbiertas: 1240000,
  tasaCierrePct: 34,
  cotizacionesPorVencerSemana: 3,
  alertas: [{ severity: "critica" as const, title: "Cliente Rival Ltda excede límite de crédito", detail: "$488.000 pendientes de $400.000 de cupo" }],
  ordenesEnCurso: [{ id: 1, orderNumber: "OP-00042", station: "sellado", status: "en_proceso", productName: "Bolsa 20x30", clientName: "Envases del Norte", avancePct: 60 }],
  ordenesEnCursoTotal: 12,
  topClientesSaldo: [{ clientId: 1, name: "Cliente ACME", saldo: 150000 }],
};

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <MemoryRouter>
            <DashboardEjecutivo />
          </MemoryRouter>
        </ThemeProvider>
      </AuthProvider>
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
    expect(screen.getByText("$90.000")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("4.200 kg")).toBeInTheDocument();
  });

  it("muestra las alertas y las órdenes de producción en curso", async () => {
    renderDashboard();
    expect(await screen.findByText("Cliente Rival Ltda excede límite de crédito")).toBeInTheDocument();
    expect((await screen.findAllByText("OP-00042")).length).toBeGreaterThan(0);
    expect(screen.getByText("Ver todas (12)")).toBeInTheDocument();
  });

  it("cartera vencida en 0 no se resalta en rojo", async () => {
    vi.mocked(api.getDashboardResumen).mockResolvedValue({ ...RESUMEN, carteraVencida: 0 } as any);
    renderDashboard();
    const value = await screen.findByText("$0");
    expect(value.className).not.toContain("text-rose-600");
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
