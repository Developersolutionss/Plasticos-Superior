import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Movimientos from "../../client/src/pages/Movimientos";

vi.mock("../../client/src/api/client", () => ({
  api: { getInventoryMovements: vi.fn() },
}));

import { api } from "../../client/src/api/client";

const PAGE = {
  items: [
    {
      id: 1,
      movementType: "entrada_produccion",
      quantity: "10",
      product: { name: "Bulto 25kg", sku: "BUL-001", unit: "kg" },
      createdBy: { name: "Juan" },
      createdAt: "2026-08-14T10:00:00Z",
    },
    {
      id: 2,
      movementType: "salida_despacho",
      quantity: "-4",
      product: { name: "Rollo Fuelle", sku: "ROL-001", unit: "unidad" },
      createdBy: null,
      createdAt: "2026-08-13T10:00:00Z",
    },
  ],
  total: 2,
  page: 1,
  pageSize: 50,
};

function renderMovimientos() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Movimientos />
    </QueryClientProvider>
  );
}

/** Tabla (desktop) y tarjetas (móvil) se renderizan a la vez en jsdom — se
 * escopea a la tabla para evitar matches duplicados. */
async function findTable() {
  return screen.findByRole("table");
}

describe("Movimientos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getInventoryMovements).mockResolvedValue(PAGE as any);
  });

  it("lista los movimientos con signo según entrada/salida", async () => {
    renderMovimientos();
    const table = within(await findTable());
    expect(table.getByText(/Bulto 25kg/)).toBeInTheDocument();
    expect(table.getByText("+10 kg")).toBeInTheDocument();
    expect(table.getByText("−4 unidad")).toBeInTheDocument();
    expect(table.getByText("Juan")).toBeInTheDocument();
    expect(table.getByText("—")).toBeInTheDocument();
  });

  it("cambiar el filtro de tipo vuelve a pedir con el nuevo movementType", async () => {
    const user = userEvent.setup();
    renderMovimientos();
    await findTable();

    await user.selectOptions(screen.getByDisplayValue("Todos los tipos"), "salida_despacho");

    expect(api.getInventoryMovements).toHaveBeenCalledWith(
      expect.objectContaining({ movementType: "salida_despacho", page: 1 })
    );
  });

  it("sin movimientos muestra el estado vacío", async () => {
    vi.mocked(api.getInventoryMovements).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 } as any);
    renderMovimientos();
    expect(await screen.findByText("Sin movimientos todavía.")).toBeInTheDocument();
  });
});
