import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dispatches from "../../client/src/pages/Dispatches";
import { AuthProvider } from "../../client/src/auth/AuthContext";
import { ConfirmProvider } from "../../client/src/components/ConfirmDialog";
import { remisionHtml } from "../../client/src/lib/printRemision";

vi.mock("../../client/src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../client/src/api/client")>("../../client/src/api/client");
  return {
    ApiError: actual.ApiError,
    api: {
      getClients: vi.fn(),
      getProducts: vi.fn(),
      getDispatches: vi.fn(),
      getWarehouseStock: vi.fn(),
      getInventory: vi.fn(),
      getClientReservations: vi.fn(),
      getDispatch: vi.fn(),
      getDispatchTargetsForRoll: vi.fn(),
      getDispatchItemRolls: vi.fn(),
      createDispatch: vi.fn(),
      cancelDispatch: vi.fn(),
      markItemDispatched: vi.fn(),
    },
  };
});

vi.mock("../../client/src/components/BarcodeScanner", () => ({
  default: ({ onDetected }: { onDetected: (code: string) => void }) => {
    const [value, setValue] = useState("");
    return (
      <div>
        <input placeholder="código escaneado" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="button" onClick={() => onDetected(value)}>
          Usar código
        </button>
      </div>
    );
  },
}));

import { api } from "../../client/src/api/client";

const jfj = { id: 4, sku: "JFJ", name: "Rollo alta densidad", unit: "kg" };
const reservado = {
  id: 3,
  status: "pendiente",
  requestedDate: "2026-10-09T05:00:00Z",
  dispatchedDate: null,
  client: { id: 1, name: "Antonio meza" },
  productionOrder: { id: 13, orderNumber: "OP-00002" },
  items: [{ id: 30, product: jfj, quantityRequested: "192", quantityDispatched: null, rolls: [] }],
};
const manual = {
  id: 2,
  status: "pendiente",
  requestedDate: "2026-10-08T05:00:00Z",
  dispatchedDate: null,
  client: { id: 1, name: "Antonio meza" },
  productionOrder: null,
  items: [{ id: 20, product: jfj, quantityRequested: "1", quantityDispatched: null, rolls: [] }],
};

function renderPage(role = "almacen_despachos") {
  localStorage.setItem("token", "t");
  localStorage.setItem("user", JSON.stringify({ id: 1, name: "Almacén", role, email: "a@empresa.com" }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ConfirmProvider>
          <MemoryRouter>
            <Dispatches />
          </MemoryRouter>
        </ConfirmProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Despachos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getClients).mockResolvedValue([{ id: 1, name: "Antonio meza" }, { id: 2, name: "Cliente ACME" }]);
    vi.mocked(api.getProducts).mockResolvedValue([jfj, { id: 5, sku: "ROL", name: "Rollo precintado", unit: "kg" }]);
    vi.mocked(api.getDispatches).mockResolvedValue([reservado, manual]);
    vi.mocked(api.getWarehouseStock).mockResolvedValue([]);
    vi.mocked(api.getInventory).mockResolvedValue([
      { id: 4, unit: "kg", currentStock: 192, reservedStock: 192, availableStock: 0 },
      { id: 5, unit: "kg", currentStock: 50, reservedStock: 0, availableStock: 50 },
    ]);
    vi.mocked(api.getClientReservations).mockResolvedValue([]);
  });

  it("dice 'Despacho #', muestra el estado con su nombre y la fecha, y avisa que un despacho a mano está esperando stock", async () => {
    renderPage();
    const card = (await screen.findByText(/Despacho #2 — Antonio meza/)).closest("div.cursor-pointer") as HTMLElement;
    expect(within(card).getByText("Pendiente")).toBeInTheDocument();
    expect(within(card).getByText(/Creado/)).toBeInTheDocument();
    expect(within(card).getByText(/Esperando stock: hay 0 kg libres \(192 kg están reservados para clientes\)/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Despachar" })).toBeDisabled();
    const res = (await screen.findByText(/Despacho #3 — Antonio meza/)).closest("div.cursor-pointer") as HTMLElement;
    expect(within(res).getByRole("button", { name: "Despachar" })).toBeEnabled();
    expect(screen.queryByText(/Pedido #/)).not.toBeInTheDocument();
    expect(api.getDispatches).toHaveBeenCalledWith({ clientId: undefined, status: "abiertos", limit: 30 });
  });

  it("nuevo despacho: precarga lo libre, avisa si se pide más, une el mismo producto repetido y muestra el error real del servidor", async () => {
    vi.mocked(api.createDispatch).mockRejectedValueOnce(new Error("Rollo precintado está desactivado, no se puede despachar"));
    renderPage();
    const user = userEvent.setup();
    await screen.findByText(/Despacho #2/);
    await user.selectOptions(screen.getByLabelText("Cliente del despacho"), "2");
    await user.selectOptions(screen.getByLabelText("Producto 1"), "5");
    expect(screen.getByLabelText("Cantidad 1")).toHaveValue(50);
    await user.clear(screen.getByLabelText("Cantidad 1"));
    await user.type(screen.getByLabelText("Cantidad 1"), "60");
    expect(screen.getByText(/Solo hay 50 kg libres/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ Agregar ítem" }));
    await user.selectOptions(screen.getByLabelText("Producto 2"), "5");
    expect(screen.getAllByText(/al crear se suman en una sola/).length).toBe(2);
    await user.clear(screen.getByLabelText("Cantidad 2"));
    await user.type(screen.getByLabelText("Cantidad 2"), "5");

    await user.click(screen.getByRole("button", { name: "Crear despacho" }));
    expect(api.createDispatch).toHaveBeenCalledWith(2, [{ productId: 5, quantityRequested: 65 }]);
    expect(await screen.findByText(/está desactivado/)).toBeInTheDocument();
  });

  it("escanear el QR de un rollo abre su despacho con el rollo ya marcado", async () => {
    vi.mocked(api.getDispatchTargetsForRoll).mockResolvedValue({
      code: "PRE-7",
      targets: [{ dispatchId: 3, itemId: 30, clientName: "Antonio meza", reserved: true, quantityRequested: 192 }],
      reason: null,
    });
    vi.mocked(api.getDispatch).mockResolvedValue(reservado);
    vi.mocked(api.getDispatchItemRolls).mockResolvedValue({
      reserved: true,
      rolls: [
        { id: 70, code: "PRE-7", label: null, weightKg: 12, orderNumber: "OP-00002", origin: "cliente", location: "Bodega principal", inMainWarehouse: true },
        { id: 71, code: "PRE-8", label: null, weightKg: 10, orderNumber: "OP-00002", origin: "cliente", location: "Precorte", inMainWarehouse: false },
      ],
    });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText(/Despacho #3/);
    await user.click(screen.getByRole("button", { name: /Escanear rollo o producto/ }));
    await user.type(screen.getByPlaceholderText("código escaneado"), "pre-7-K7M9XT4P2R6HW3JC");
    await user.click(screen.getByRole("button", { name: "Usar código" }));
    expect(api.getDispatchTargetsForRoll).toHaveBeenCalledWith("PRE-7", "K7M9XT4P2R6HW3JC");
    expect(await screen.findByText("Despachar a Antonio meza")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Cantidad a despachar/)).toHaveValue(12);
    expect(screen.getByText(/está en: Precorte \(todavía no volvió a la principal\)/)).toBeInTheDocument();
  });

  it("si el rollo no tiene despacho, dice por qué", async () => {
    vi.mocked(api.getDispatchTargetsForRoll).mockResolvedValue({ code: "SELL-1", targets: [], reason: "El rollo SELL-1 ya salió hacia un cliente en otro despacho" });
    renderPage();
    const user = userEvent.setup();
    await screen.findByText(/Despacho #3/);
    await user.click(screen.getByRole("button", { name: /Escanear rollo o producto/ }));
    await user.type(screen.getByPlaceholderText("código escaneado"), "SELL-1-ABCDEFGH12345678");
    await user.click(screen.getByRole("button", { name: "Usar código" }));
    expect(await screen.findByText(/ya salió hacia un cliente en otro despacho/)).toBeInTheDocument();
  });

  it("el detalle muestra la OP, los rollos y permite imprimir la remisión", async () => {
    const despachado = {
      ...reservado,
      status: "en_proceso",
      client: { id: 1, name: "Antonio meza", addresses: [{ addressLine: "Calle 1 # 2-3", city: "Cali" }], contacts: [{ name: "Rosa", phone: "300" }] },
      createdBy: { name: "Admin" },
      items: [
        { id: 30, product: jfj, quantityRequested: "22", quantityDispatched: "22", rolls: [{ code: "PRE-7", weightKg: "12", scannedBy: { name: "Almacén" } }, { code: "PRE-8", weightKg: "10" }] },
        { id: 31, product: jfj, quantityRequested: "170", quantityDispatched: null, rolls: [] },
      ],
    };
    vi.mocked(api.getDispatch).mockResolvedValue(despachado);
    const open = vi.spyOn(window, "open").mockReturnValue({ document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() } as any);
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText(/Despacho #3 — Antonio meza/));
    expect(await screen.findByText(/Calle 1 # 2-3, Cali/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "OP-00002" })).toHaveLength(2); // tarjeta y detalle
    expect(screen.getByText(/PRE-7 \(12 kg, escaneó Almacén\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Imprimir remisión/ }));
    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });
});

describe("Remisión impresa", () => {
  it("lleva cliente, dirección, contacto, lo despachado con sus rollos, lo pendiente y las firmas", () => {
    const html = remisionHtml({
      id: 3,
      dispatchedDate: "2026-10-22T15:00:00Z",
      productionOrder: { orderNumber: "OP-00002" },
      createdBy: { name: "Admin" },
      client: { name: "Antonio <meza>", addresses: [{ addressLine: "Calle 1 # 2-3", city: "Cali" }], contacts: [{ name: "Rosa", phone: "300" }] },
      items: [
        { product: { sku: "JFJ", name: "Rollo alta densidad", unit: "kg" }, quantityRequested: 22, quantityDispatched: 22, rolls: [{ code: "PRE-7", weightKg: 12 }, { code: "PRE-8", weightKg: 10 }] },
        { product: { sku: "JFJ", name: "Rollo alta densidad", unit: "kg" }, quantityRequested: 170, quantityDispatched: null, rolls: [] },
      ],
    });
    expect(html).toContain("Remisión de despacho");
    expect(html).toContain("Despacho #3");
    expect(html).toContain("Antonio &lt;meza&gt;");
    expect(html).toContain("Calle 1 # 2-3, Cali");
    expect(html).toContain("Rosa · 300");
    expect(html).toContain("PRE-7 (12 kg), PRE-8 (10 kg)");
    expect(html).toContain("Total: 2 rollos · 22 kg");
    expect(html).toContain("Pendiente por despachar: Rollo alta densidad 170 kg");
    expect(html).toContain("Recibió (cliente)");
  });
});
