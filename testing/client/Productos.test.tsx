import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Productos from "../../client/src/pages/Productos";

vi.mock("../../client/src/api/client", () => ({
  api: {
    getAllProducts: vi.fn(),
    deactivateProduct: vi.fn().mockResolvedValue({}),
    reactivateProduct: vi.fn().mockResolvedValue({}),
    getProductLabel: vi.fn(),
  },
}));

import { api } from "../../client/src/api/client";

const PRODUCTS = [
  { id: 1, sku: "BUL-001", name: "Bulto 25kg", category: "bultos", unit: "kg", minStock: 10, unitPrice: 5000, active: true },
  { id: 2, sku: "ROL-001", name: "Rollo Fuelle", category: "rollos_fuelle", unit: "unidad", minStock: 0, unitPrice: 1200, active: false },
];

function renderProductos() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Productos />
    </QueryClientProvider>
  );
}

/** Las páginas renderizan tabla (desktop) y tarjetas (móvil) a la vez —
 * jsdom no aplica `hidden md:table` / `md:hidden`, así que ambas quedan en
 * el DOM. Se escopea a la tabla para evitar matches duplicados. */
async function findTable() {
  return screen.findByRole("table");
}

describe("Productos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getAllProducts).mockResolvedValue(PRODUCTS as any);
  });

  it("lista los productos activos e inactivos con su estado", async () => {
    renderProductos();
    const table = within(await findTable());
    expect(table.getByText("Bulto 25kg")).toBeInTheDocument();
    expect(table.getByText("Rollo Fuelle")).toBeInTheDocument();
    expect(table.getByText("Activo")).toBeInTheDocument();
    expect(table.getByText("Inactivo")).toBeInTheDocument();
  });

  it("desactivar exige confirmación en dos pasos", async () => {
    const user = userEvent.setup();
    renderProductos();
    const table = within(await findTable());

    await user.click(table.getByText("Desactivar"));
    expect(api.deactivateProduct).not.toHaveBeenCalled();

    await user.click(table.getByText("Confirmar"));
    expect(api.deactivateProduct).toHaveBeenCalledWith(1);
  });

  it("cancelar la desactivación no llama a la API", async () => {
    const user = userEvent.setup();
    renderProductos();
    const table = within(await findTable());

    await user.click(table.getByText("Desactivar"));
    await user.click(table.getByText("Cancelar"));
    expect(api.deactivateProduct).not.toHaveBeenCalled();
    expect(table.queryByText("Confirmar")).not.toBeInTheDocument();
  });

  it("reactiva un producto inactivo", async () => {
    const user = userEvent.setup();
    renderProductos();
    const table = within(await findTable());

    await user.click(table.getByText("Reactivar"));
    expect(api.reactivateProduct).toHaveBeenCalledWith(2);
  });

  it("seleccionar productos habilita imprimir etiquetas y abre la ventana con el QR", async () => {
    const user = userEvent.setup();
    const winStub = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(winStub as any);
    vi.mocked(api.getProductLabel).mockResolvedValue({
      sku: "BUL-001",
      name: "Bulto 25kg",
      category: "bultos",
      measure: null,
      unit: "kg",
      qrDataUrl: "data:image/png;base64,xxx",
    } as any);

    renderProductos();
    const table = within(await findTable());

    const checkboxes = table.getAllByRole("checkbox");
    // La primera checkbox es "seleccionar todos"; la fila de BUL-001 es la segunda.
    await user.click(checkboxes[1]);

    const printButton = await screen.findByText("Imprimir etiquetas (1)");
    await user.click(printButton);

    expect(api.getProductLabel).toHaveBeenCalledWith(1);
    expect(window.open).toHaveBeenCalledWith("", "_blank");
    expect(winStub.document.write).toHaveBeenCalledWith(expect.stringContaining("BUL-001"));
  });

  it("abre el modal de creación al hacer clic en Nuevo producto", async () => {
    const user = userEvent.setup();
    renderProductos();
    await findTable();

    await user.click(screen.getByText("Nuevo producto"));
    expect(screen.getByText("Crear producto")).toBeInTheDocument();
  });
});
