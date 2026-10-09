import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DispatchItemModal from "../../client/src/components/DispatchItemModal";

vi.mock("../../client/src/api/client", async () => {
  const actual = await vi.importActual<typeof import("../../client/src/api/client")>("../../client/src/api/client");
  return { ApiError: actual.ApiError, api: { getDispatchItemRolls: vi.fn(), markItemDispatched: vi.fn() } };
});

// El escáner real usa la cámara: mismo reemplazo por "código a mano".
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

const product = { id: 7, name: "Rollo Precintado 20x30", sku: "ROL-PL-001", unit: "kg" };
const dispatch = (over: Record<string, unknown> = {}) => ({
  id: 50,
  client: { id: 1, name: "Cliente ACME" },
  productionOrder: { id: 9, orderNumber: "OP-00031" },
  ...over,
});
const item = { id: 5, product, quantityRequested: "27", quantityDispatched: null };
const ROLLS = [
  { id: 100, code: "SELL-10", label: null, weightKg: 15, orderNumber: "OP-00031", origin: "cliente" },
  { id: 101, code: "SELL-11", label: null, weightKg: 12, orderNumber: "OP-00031", origin: "cliente" },
];

function renderModal(d: any = dispatch(), locations: any[] = [], onDone = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DispatchItemModal dispatch={d} item={item} locations={locations} onClose={vi.fn()} onDone={onDone} />
    </QueryClientProvider>
  );
  return { onDone };
}

async function scan(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(screen.getByRole("button", { name: /Escanear rollo/ }));
  await user.type(screen.getByPlaceholderText("código escaneado"), value);
  await user.click(screen.getByRole("button", { name: "Usar código" }));
}

describe("DispatchItemModal · despachar rollos a un cliente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getDispatchItemRolls).mockResolvedValue({ reserved: true, rolls: ROLLS } as any);
    vi.mocked(api.markItemDispatched).mockResolvedValue({ ok: true, partial: null } as any);
  });

  it("en la reserva de un cliente no se puede despachar sin escanear; la cantidad se llena sola con la suma de los rollos", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText("SELL-10");
    const confirmar = screen.getByRole("button", { name: "Marcar despachado" });
    expect(confirmar).toBeDisabled();

    await scan(user, "sell-10-K7M9XT4P2R6HW3JC"); // minúsculas, como tipeado a mano
    expect(confirmar).toBeEnabled();
    expect(screen.getByLabelText(/Cantidad a despachar/)).toHaveValue(15);
    expect(screen.getByText(/Despacho parcial: salen 15 y quedan 12 kg pendientes/)).toBeInTheDocument();
    expect(screen.getByText(/siguen reservados para el cliente/)).toBeInTheDocument();

    await scan(user, "SELL-11-ABCDEFGH12345678");
    expect(screen.getByLabelText(/Cantidad a despachar/)).toHaveValue(27);
    expect(screen.queryByText(/Despacho parcial/)).not.toBeInTheDocument();

    await user.click(confirmar);
    expect(api.markItemDispatched).toHaveBeenCalledWith(50, 5, 27, undefined, [
      { code: "SELL-10", token: "K7M9XT4P2R6HW3JC" },
      { code: "SELL-11", token: "ABCDEFGH12345678" },
    ]);
  });

  it("un rollo que no es de esa OP, o sin token, se rechaza al escanear", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText("SELL-10");
    await scan(user, "SELL-99-TOKENTOKENTOKEN1");
    expect(screen.getByText(/El rollo SELL-99 no es de OP-00031/)).toBeInTheDocument();
    await scan(user, "SELL-10");
    expect(screen.getByText(/no trae el token/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar despachado" })).toBeDisabled();
  });

  it("despachar parcial avisa lo que queda pendiente", async () => {
    vi.mocked(api.markItemDispatched).mockResolvedValue({ ok: true, partial: { remainingItemId: 6, remaining: 12 } } as any);
    const user = userEvent.setup();
    const { onDone } = renderModal();
    await screen.findByText("SELL-10");
    await scan(user, "SELL-10-K7M9XT4P2R6HW3JC");
    await user.click(screen.getByRole("button", { name: "Marcar despachado" }));
    expect(await vi.waitFor(() => onDone.mock.calls[0][0])).toMatch(/se despacharon 15 kg \(SELL-10\)\. Quedan 12 kg pendientes/);
  });

  it("quitar un rollo escaneado recalcula la cantidad; si el servidor rechaza, se ve el motivo", async () => {
    vi.mocked(api.markItemDispatched).mockRejectedValue(new Error("El rollo SELL-10 ya salió en otro despacho"));
    const user = userEvent.setup();
    renderModal();
    await screen.findByText("SELL-10");
    await scan(user, "SELL-10-K7M9XT4P2R6HW3JC");
    await scan(user, "SELL-11-ABCDEFGH12345678");
    const fila = screen.getByText("SELL-11").closest("li") as HTMLElement;
    await user.click(within(fila).getByRole("button", { name: "Quitar" }));
    expect(screen.getByLabelText(/Cantidad a despachar/)).toHaveValue(15);
    await user.click(screen.getByRole("button", { name: "Marcar despachado" }));
    expect(await screen.findByText(/ya salió en otro despacho/)).toBeInTheDocument();
  });

  it("un despacho a mano sin rollos registrados se despacha por cantidad, y el estante es obligatorio si hay stock ubicado", async () => {
    vi.mocked(api.getDispatchItemRolls).mockResolvedValue({ reserved: false, rolls: [] } as any);
    const user = userEvent.setup();
    renderModal(dispatch({ productionOrder: null }), [{ locationId: 3, code: "A-1", quantity: 30 }]);
    expect(await screen.findByText(/se despacha por cantidad/)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Sin estante/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Marcar despachado" }));
    expect(api.markItemDispatched).toHaveBeenCalledWith(50, 5, 27, 3, []);
  });
});
