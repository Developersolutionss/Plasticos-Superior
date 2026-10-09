import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RollosClientes from "../../client/src/pages/RollosClientes";
import InventoryDashboard from "../../client/src/pages/InventoryDashboard";

vi.mock("../../client/src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../client/src/api/client")>("../../client/src/api/client");
  return {
    ApiError: actual.ApiError,
    api: { getClientReservations: vi.fn(), getInventory: vi.fn(), getAlerts: vi.fn() },
  };
});

import { api } from "../../client/src/api/client";

const producto = { id: 7, sku: "ROL-PL-001", name: "Rollo Precintado 20x30", unit: "kg" };
const reserva = (over: Record<string, unknown>) => ({
  dispatchId: 50,
  status: "pendiente",
  client: { id: 1, name: "Cliente ACME" },
  productionOrder: { id: 9, orderNumber: "OP-00031", station: "sellado" },
  approvedAt: "2026-10-06T21:00:00Z",
  items: [{ id: 1, product: producto, quantityRequested: 27, quantityDispatched: null }],
  reservedQuantity: 27,
  rolls: [
    { id: 100, code: "SELL-10", label: null, weightKg: 15 },
    { id: 101, code: "SELL-11", label: null, weightKg: 12 },
  ],
  ...over,
});

function renderWith(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Rollos para clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getClientReservations).mockResolvedValue([
      reserva({}),
      reserva({ dispatchId: 51, client: { id: 2, name: "Distribuidora Norte" }, productionOrder: { id: 10, orderNumber: "OP-00040", station: "precorte" }, reservedQuantity: 40, rolls: [{ id: 200, code: "PRE-5", label: null, weightKg: 40 }] }),
    ] as any);
  });

  it("agrupa por cliente, con la OP, lo reservado, los rollos y el despacho", async () => {
    renderWith(<RollosClientes />);
    const acme = (await screen.findByText("Cliente ACME", { selector: "p" })).closest("section") as HTMLElement;
    expect(within(acme).getByRole("link", { name: "OP-00031" })).toHaveAttribute("href", "/produccion/ordenes/9");
    expect(within(acme).getByText(/27 kg/)).toBeInTheDocument();
    expect(within(acme).getByText("SELL-10").closest("li")).toHaveTextContent("SELL-10 · 15 kg");
    expect(within(acme).getByText("SELL-11")).toBeInTheDocument();
    expect(within(acme).getByRole("link", { name: /Despacho #50 \(pendiente\)/ })).toBeInTheDocument();
    expect(screen.getByText("Distribuidora Norte", { selector: "p" })).toBeInTheDocument();
  });

  it("se filtra por cliente", async () => {
    renderWith(<RollosClientes />);
    await screen.findByText("Cliente ACME", { selector: "p" });
    await userEvent.setup().selectOptions(screen.getByLabelText("Cliente"), "2");
    expect(screen.queryByText("Cliente ACME", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.getByText("PRE-5")).toBeInTheDocument();
  });

  it("sin reservas lo dice", async () => {
    vi.mocked(api.getClientReservations).mockResolvedValue([]);
    renderWith(<RollosClientes />);
    expect(await screen.findByText(/No hay nada reservado para clientes/)).toBeInTheDocument();
  });
});

describe("Existencias: total, reservado y disponible", () => {
  it("muestra lo reservado (con enlace a Rollos para clientes) y lo disponible", async () => {
    vi.mocked(api.getAlerts).mockResolvedValue([]);
    vi.mocked(api.getInventory).mockResolvedValue([
      { id: 7, sku: "ROL-PL-001", name: "Rollo Precintado 20x30", category: "rollos_prec_lam", measure: "20x30", unit: "kg", minStock: 100, currentStock: 1054, reservedStock: 27, availableStock: 1027, belowMinimum: false },
      { id: 8, sku: "TIR-1", name: "Tira", category: "tiras", measure: null, unit: "kg", minStock: 0, currentStock: 5, reservedStock: 0, availableStock: 5, belowMinimum: false },
    ]);
    renderWith(<InventoryDashboard />);
    const fila = (await screen.findAllByText("ROL-PL-001"))[0].closest("tr") as HTMLElement;
    expect(within(fila).getByRole("link", { name: "27 kg" })).toHaveAttribute("href", "/inventario/rollos-clientes");
    expect(within(fila).getByText("1027 kg")).toBeInTheDocument();
    const otra = screen.getAllByText("TIR-1")[0].closest("tr") as HTMLElement;
    expect(within(otra).getByText("—")).toBeInTheDocument();
  });
});
