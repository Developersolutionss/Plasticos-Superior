import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InventarioBodegas from "../../client/src/pages/InventarioBodegas";
import { AuthProvider } from "../../client/src/auth/AuthContext";

vi.mock("../../client/src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../client/src/api/client")>("../../client/src/api/client");
  return {
    ApiError: actual.ApiError,
    api: { getWarehouseInventory: vi.fn(), countRoll: vi.fn() },
  };
});

import { api, ApiError } from "../../client/src/api/client";

const op = { id: 3, orderNumber: "OP-00003", product: { name: "Bolsa 20x30", sku: "SKU1" } };
const roll = (over: Record<string, unknown>) => ({
  rollId: 1,
  code: "EXT-1",
  label: null,
  weightKg: 60,
  remainingKg: 60,
  productionOrder: op,
  lastCount: null,
  since: "2026-09-20T10:00:00Z",
  days: 0,
  stale: false,
  ...over,
});

const INVENTORY = {
  staleDays: 7,
  warehouses: [
    { station: "extrusion", label: "Extrusión", rollCount: 1, totalKg: 60, staleCount: 0, inTransitCount: 0, inTransitKg: 0, items: [roll({})] },
    { station: "impresion", label: "Impresión", rollCount: 0, totalKg: 0, staleCount: 0, inTransitCount: 0, inTransitKg: 0, items: [] },
    {
      station: "sellado",
      label: "Sellado",
      rollCount: 1,
      totalKg: 35,
      staleCount: 1,
      inTransitCount: 0,
      inTransitKg: 0,
      items: [roll({ rollId: 2, code: "EXT-2", weightKg: 60, remainingKg: 35, days: 10, stale: true })],
    },
    { station: "precorte", label: "Precorte", rollCount: 0, totalKg: 0, staleCount: 0, inTransitCount: 1, inTransitKg: 80, items: [] },
  ],
  inTransit: [
    {
      ...roll({ rollId: 3, code: "EXT-3", weightKg: 80, remainingKg: 80 }),
      transferId: 9,
      fromStation: "extrusion",
      toStation: "precorte",
      carrierName: "Juan Camionero",
      hours: 5,
      dispatchedKg: 80,
    },
  ],
};

function renderPage(role: string) {
  localStorage.setItem("token", "t");
  localStorage.setItem("user", JSON.stringify({ id: 1, name: "Usuario", role, email: "u@empresa.com" }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter>
          <InventarioBodegas />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("InventarioBodegas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getWarehouseInventory).mockResolvedValue(INVENTORY as any);
  });

  it("muestra cada bodega con su total, los rollos parados y lo que está en camino", async () => {
    renderPage("almacen_despachos");
    expect(await screen.findByText("Bodega de Sellado")).toBeInTheDocument();
    expect(screen.getByText("1 parado más de 7 días")).toBeInTheDocument();
    expect(screen.getByText(/Está acá hace 10 días \(más de 7 días sin usarse\)/)).toBeInTheDocument();
    expect(screen.getByText("de 60 kg")).toBeInTheDocument(); // EXT-2: saldo 35 de 60
    expect(screen.getByText(/lo lleva Juan Camionero/)).toBeInTheDocument();
    expect(screen.getByText(/1 en camino \(80 kg\)/)).toBeInTheDocument();
    // Un operario no ajusta por conteo.
    expect(screen.queryByText("Ajustar por conteo")).not.toBeInTheDocument();
  });

  it("un operario abre directo en la bodega de su estación y puede volver a ver todas", async () => {
    renderPage("operario_sellado");
    await screen.findByText("Bodega de Sellado");
    expect(screen.queryByText("Bodega de Extrusión")).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Sellado.*35 kg/ }));
    expect(screen.getByText("Bodega de Extrusión")).toBeInTheDocument();
  });

  it("tocar una bodega filtra la lista a esa bodega", async () => {
    renderPage("almacen_despachos");
    await screen.findByText("Bodega de Sellado");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Sellado.*35 kg/ }));
    expect(screen.getByText("Bodega de Sellado")).toBeInTheDocument();
    expect(screen.queryByText("Bodega de Extrusión")).not.toBeInTheDocument();
    expect(screen.queryByText(/lo lleva Juan Camionero/)).not.toBeInTheDocument(); // va a Precorte
  });

  it("Gestión ajusta un rollo por conteo y ve el resultado; si el servidor rechaza, ve el motivo", async () => {
    renderPage("gerente_produccion");
    await screen.findByText("Bodega de Sellado");
    const user = userEvent.setup();
    const fila = screen.getByText("EXT-2").closest("li") as HTMLElement;

    vi.mocked(api.countRoll).mockResolvedValueOnce({ rollId: 2, code: "EXT-2", previousKg: 35, newKg: 33.5, deltaKg: -1.5 });
    await user.click(within(fila).getByText("Ajustar por conteo"));
    const peso = within(fila).getByLabelText("Peso contado de EXT-2");
    await user.clear(peso);
    await user.type(peso, "33.5");
    await user.type(within(fila).getByLabelText("Motivo del ajuste de EXT-2"), "Pesaje de inventario");
    await user.click(within(fila).getByRole("button", { name: "Guardar conteo" }));
    expect(api.countRoll).toHaveBeenCalledWith(2, { countedKg: 33.5, notes: "Pesaje de inventario" });
    expect(await within(fila).findByText("EXT-2: saldo 35 → 33.5 kg (-1.5 kg)")).toBeInTheDocument();

    vi.mocked(api.countRoll).mockRejectedValueOnce(new ApiError("El rollo EXT-2 está en camino a Precorte — primero hay que recibirlo", 400));
    await user.click(within(fila).getByText("Ajustar por conteo"));
    await user.type(within(fila).getByLabelText("Motivo del ajuste de EXT-2"), "Re-pesaje");
    await user.click(within(fila).getByRole("button", { name: "Guardar conteo" }));
    expect(await within(fila).findByText(/está en camino a Precorte/)).toBeInTheDocument();
  });
});
