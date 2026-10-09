import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
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

// El escáner real usa la cámara (no hay en jsdom): mismo reemplazo por
// "código a mano" que en OrdenProduccionDetalle.test.tsx.
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
  pendingTo: [],
  ...over,
});

const INVENTORY = {
  staleDays: 7,
  staleTransitHours: 24,
  warehouses: [
    {
      station: "extrusion",
      label: "Extrusión",
      rollCount: 1,
      totalKg: 60,
      staleCount: 0,
      inTransitCount: 0,
      staleTransitCount: 0,
      inTransitKg: 0,
      items: [roll({ pendingTo: ["sellado"] })],
    },
    { station: "impresion", label: "Impresión", rollCount: 0, totalKg: 0, staleCount: 0, inTransitCount: 0, staleTransitCount: 0, inTransitKg: 0, items: [] },
    {
      station: "sellado",
      label: "Sellado",
      rollCount: 1,
      totalKg: 35,
      staleCount: 1,
      inTransitCount: 0,
      staleTransitCount: 0,
      inTransitKg: 0,
      items: [roll({ rollId: 2, code: "EXT-2", weightKg: 60, remainingKg: 35, days: 10, stale: true })],
    },
    { station: "precorte", label: "Precorte", rollCount: 0, totalKg: 0, staleCount: 0, inTransitCount: 1, staleTransitCount: 1, inTransitKg: 80, items: [] },
  ],
  inTransit: [
    {
      ...roll({ rollId: 3, code: "EXT-3", weightKg: 80, remainingKg: 80 }),
      transferId: 9,
      fromStation: "extrusion",
      toStation: "precorte",
      carrierName: "Juan Camionero",
      hours: 30,
      stale: true,
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
    expect(within(fila).getByLabelText("Motivo del ajuste de EXT-2")).toHaveValue("Pesaje de inventario");
    await user.clear(peso);
    await user.type(peso, "33.5");
    await user.click(within(fila).getByRole("button", { name: "Guardar conteo" }));
    expect(api.countRoll).toHaveBeenCalledWith(2, { countedKg: 33.5, notes: "Pesaje de inventario" });
    expect(await within(fila).findByText("EXT-2: saldo 35 → 33.5 kg (-1.5 kg)")).toBeInTheDocument();

    vi.mocked(api.countRoll).mockRejectedValueOnce(new ApiError("El rollo EXT-2 está en camino a Precorte — primero hay que recibirlo", 400));
    await user.click(within(fila).getByText("Ajustar por conteo"));
    await user.clear(within(fila).getByLabelText("Motivo del ajuste de EXT-2"));
    await user.type(within(fila).getByLabelText("Motivo del ajuste de EXT-2"), "Re-pesaje");
    await user.click(within(fila).getByRole("button", { name: "Guardar conteo" }));
    expect(await within(fila).findByText(/está en camino a Precorte/)).toBeInTheDocument();
  });

  it("marca a dónde está pendiente de despacharse un rollo y lo que lleva demasiado en camino", async () => {
    renderPage("almacen_despachos");
    await screen.findByText("Bodega de Sellado");
    expect(screen.getByText("Pendiente de despachar a Sellado")).toBeInTheDocument();
    expect(screen.getByText("1 sin recibir hace más de 24 h")).toBeInTheDocument();
    expect(screen.getByText(/nadie confirmó que llegó/)).toBeInTheDocument();
  });

  it("escanear un rollo lo ubica: filtra a su bodega, y a Gestión le abre el conteo ya listo", async () => {
    renderPage("gerente_produccion");
    await screen.findByText("Bodega de Sellado");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Escanear rollo/ }));
    // Con token y todo, como sale del QR: solo se usa el código.
    await user.type(screen.getByPlaceholderText("código escaneado"), "ext-2-K7M9XT4P2R6HW3JC");
    await user.click(screen.getByRole("button", { name: "Usar código" }));

    expect(await screen.findByText("EXT-2 está en la bodega de Sellado")).toBeInTheDocument();
    expect(screen.queryByText("Bodega de Extrusión")).not.toBeInTheDocument();
    const fila = screen.getByText("EXT-2").closest("li") as HTMLElement;
    expect(within(fila).getByLabelText("Peso contado de EXT-2")).toHaveValue(35);
    expect(within(fila).getByLabelText("Peso contado de EXT-2")).toHaveFocus();
  });

  it("escanear: uno en camino dice a dónde va; uno que no está en ninguna bodega lo avisa", async () => {
    renderPage("operario_sellado");
    await screen.findByText("Bodega de Sellado");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Escanear rollo/ }));
    await user.type(screen.getByPlaceholderText("código escaneado"), "EXT-3");
    await user.click(screen.getByRole("button", { name: "Usar código" }));
    expect(await screen.findByText(/EXT-3 está en camino a la bodega de Precorte \(lo lleva Juan Camionero\)/)).toBeInTheDocument();
    expect(screen.getByText("Bodega de Precorte")).toBeInTheDocument();
    // Un operario no cuenta: no se abre nada.
    expect(screen.queryByLabelText(/Peso contado/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Escanear rollo/ }));
    await user.type(screen.getByPlaceholderText("código escaneado"), "EXT-99");
    await user.click(screen.getByRole("button", { name: "Usar código" }));
    expect(await screen.findByText(/EXT-99 no está en ninguna bodega con saldo/)).toBeInTheDocument();
  });

  it("la bodega principal aparece con lo terminado que ya volvió; lo terminado que sigue en su estación dice que falta devolverlo, y no se cuenta", async () => {
    const terminado = (over: Record<string, unknown>) => roll({ finished: true, pendingReturn: false, weightKg: 18, remainingKg: 18, ...over });
    vi.mocked(api.getWarehouseInventory).mockResolvedValue({
      ...INVENTORY,
      warehouses: [
        ...INVENTORY.warehouses.map((w) =>
          w.station === "precorte"
            ? { ...w, rollCount: 1, totalKg: 18, pendingReturnCount: 1, items: [terminado({ rollId: 20, code: "PRE-7", pendingReturn: true })] }
            : { ...w, pendingReturnCount: 0 }
        ),
        {
          station: "principal",
          label: "Bodega principal",
          rollCount: 1,
          totalKg: 18,
          staleCount: 0,
          pendingReturnCount: 0,
          inTransitCount: 0,
          staleTransitCount: 0,
          inTransitKg: 0,
          items: [terminado({ rollId: 21, code: "SELL-4" })],
        },
      ],
    } as any);
    renderPage("gerente_produccion");
    expect((await screen.findAllByText("Bodega principal")).length).toBeGreaterThan(0);
    expect(screen.getByText("1 por devolver a la principal")).toBeInTheDocument();

    const falta = screen.getByText("PRE-7").closest("li") as HTMLElement;
    expect(within(falta).getByText("Falta devolverlo a la bodega principal")).toBeInTheDocument();
    expect(within(falta).getByText("producto terminado")).toBeInTheDocument();
    expect(within(falta).queryByText("Ajustar por conteo")).not.toBeInTheDocument();

    const enPrincipal = screen.getByText("SELL-4").closest("li") as HTMLElement;
    expect(within(enPrincipal).queryByText("Falta devolverlo a la bodega principal")).not.toBeInTheDocument();
    // Tocar la tarjeta filtra a la principal.
    await userEvent.setup().click(screen.getByRole("button", { name: /Bodega principal.*18 kg/ }));
    expect(screen.queryByText("PRE-7")).not.toBeInTheDocument();
    expect(screen.getByText("SELL-4")).toBeInTheDocument();
  });
});
