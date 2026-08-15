import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Almacen from "../../client/src/pages/Almacen";

vi.mock("../../client/src/api/client", () => ({
  api: {
    getWarehouseLocations: vi.fn(),
    getWarehouseStock: vi.fn(),
    createWarehouseLocation: vi.fn().mockResolvedValue({}),
    assignWarehouseStock: vi.fn(),
    getWarehouseLocationQr: vi.fn(),
    getWarehouseLocationByToken: vi.fn(),
  },
}));

import { api } from "../../client/src/api/client";

const LOCATIONS = [{ id: 1, code: "A-1", label: "Estante 1", createdAt: "2026-08-01T00:00:00Z" }];
const STOCK = [
  {
    productId: 1,
    sku: "BUL-001",
    name: "Bulto 25kg",
    unit: "kg",
    totalStock: 100,
    unassigned: 20,
    locations: [{ locationId: 1, code: "A-1", label: "Estante 1", quantity: 80 }],
  },
];

function renderAlmacen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Almacen />
    </QueryClientProvider>
  );
}

/** La tabla de stock (desktop) y las tarjetas (móvil) se renderizan a la
 * vez en jsdom — se escopea a la tabla para evitar matches duplicados,
 * incluido el formulario de asignación que se abre dentro de la fila. */
async function findTable() {
  return screen.findByRole("table");
}

describe("Almacen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWarehouseLocations).mockResolvedValue(LOCATIONS as any);
    vi.mocked(api.getWarehouseStock).mockResolvedValue(STOCK as any);
  });

  it("lista ubicaciones y el stock por producto (total y sin ubicar)", async () => {
    renderAlmacen();
    expect(await screen.findByText("A-1")).toBeInTheDocument();
    const table = within(await findTable());
    expect(table.getByText(/Bulto 25kg/)).toBeInTheDocument();
    expect(table.getByText("100 kg")).toBeInTheDocument();
    expect(table.getByText("20 kg")).toBeInTheDocument();
  });

  it("crea una ubicación nueva con código y nombre", async () => {
    const user = userEvent.setup();
    renderAlmacen();
    await screen.findByText("A-1");

    await user.type(screen.getByPlaceholderText("Ej. A-3"), "B-2");
    await user.type(screen.getByPlaceholderText("Ej. Bodega A - Estante 3"), "Estante 2");
    await user.click(screen.getByText("Crear ubicación"));

    expect(api.createWarehouseLocation).toHaveBeenCalledWith({ code: "B-2", label: "Estante 2" });
  });

  it("muestra un error si el código de ubicación ya existe", async () => {
    vi.mocked(api.createWarehouseLocation).mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderAlmacen();
    await screen.findByText("A-1");

    await user.type(screen.getByPlaceholderText("Ej. A-3"), "A-1");
    await user.type(screen.getByPlaceholderText("Ej. Bodega A - Estante 3"), "Duplicada");
    await user.click(screen.getByText("Crear ubicación"));

    expect(await screen.findByText(/código repetido/i)).toBeInTheDocument();
  });

  it("expandir un producto muestra sus ubicaciones y permite asignar stock", async () => {
    vi.mocked(api.assignWarehouseStock).mockResolvedValue({ ok: true } as any);
    const user = userEvent.setup();
    renderAlmacen();
    const table = within(await findTable());

    await user.click(table.getByText(/Bulto 25kg/));
    expect(table.getByText(/80 kg/)).toBeInTheDocument();

    await user.selectOptions(table.getByText("Elegir...").closest("select")!, "1");
    await user.type(table.getByPlaceholderText("0.00"), "15");
    await user.click(table.getByText("Asignar"));

    expect(api.assignWarehouseStock).toHaveBeenCalledWith({
      productId: 1,
      toLocationId: 1,
      quantity: 15,
      fromLocationId: undefined,
    });
  });

  it("un error de asignación (stock insuficiente) muestra un mensaje", async () => {
    vi.mocked(api.assignWarehouseStock).mockRejectedValue(new Error("insuficiente"));
    const user = userEvent.setup();
    renderAlmacen();
    const table = within(await findTable());

    await user.click(table.getByText(/Bulto 25kg/));
    await user.selectOptions(table.getByText("Elegir...").closest("select")!, "1");
    await user.type(table.getByPlaceholderText("0.00"), "9999");
    await user.click(table.getByText("Asignar"));

    expect(await table.findByText(/no se pudo asignar/i)).toBeInTheDocument();
  });

  it("abre el modal con el QR de la ubicación", async () => {
    vi.mocked(api.getWarehouseLocationQr).mockResolvedValue({
      dataUrl: "data:image/png;base64,xxx",
      url: "http://localhost:5173/qr/abc123",
    } as any);
    const user = userEvent.setup();
    renderAlmacen();
    await screen.findByText("A-1");

    await user.click(screen.getByTitle("Ver QR"));
    expect(await screen.findByText("Código QR de la ubicación")).toBeInTheDocument();
    expect(await screen.findByAltText("Código QR de la ubicación")).toBeInTheDocument();
  });
});
