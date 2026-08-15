import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Facturas from "../../client/src/pages/Facturas";

vi.mock("../../client/src/api/client", () => ({
  api: {
    getClients: vi.fn().mockResolvedValue([]),
    getProducts: vi.fn().mockResolvedValue([]),
    getFacturas: vi.fn(),
    getFacturaPayments: vi.fn().mockResolvedValue([]),
    createFactura: vi.fn(),
    createPayment: vi.fn(),
    anularFactura: vi.fn(),
    downloadFacturaPdf: vi.fn().mockResolvedValue(undefined),
  },
}));

import { api } from "../../client/src/api/client";

const FACTURA_VENCIDA = {
  id: 1,
  invoiceNumber: "FAC-00001",
  status: "emitida",
  dueDate: "2020-01-01T00:00:00Z",
  client: { id: 1, name: "Cliente ACME" },
  items: [{ id: 1, quantity: 2, unitPrice: 5000, product: { name: "Bulto 25kg" } }],
  payments: [],
};

const FACTURA_AL_DIA = {
  id: 2,
  invoiceNumber: "FAC-00002",
  status: "pagada",
  dueDate: "2099-01-01T00:00:00Z",
  client: { id: 1, name: "Cliente ACME" },
  items: [{ id: 2, quantity: 1, unitPrice: 3000, product: { name: "Rollo" } }],
  payments: [{ id: 1, amount: 3000 }],
};

function renderFacturas() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Facturas />
    </QueryClientProvider>
  );
}

describe("Facturas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getFacturas).mockResolvedValue([FACTURA_VENCIDA, FACTURA_AL_DIA] as any);
  });

  it("marca 'Vencida' solo la factura con dueDate pasado y saldo pendiente", async () => {
    renderFacturas();
    await screen.findByText("FAC-00001");
    expect(screen.getByText("Vencida")).toBeInTheDocument();
    // La pagada (FAC-00002) no debe llevar la etiqueta aunque su fecha también pasó/no importa: está saldada.
    const fac2Button = screen.getByText("FAC-00002").closest("button")!;
    expect(fac2Button.textContent).not.toContain("Vencida");
  });

  it("seleccionar una factura muestra el vencimiento y permite descargar el PDF", async () => {
    const user = userEvent.setup();
    renderFacturas();
    await user.click(await screen.findByText("FAC-00001"));

    expect(await screen.findByText(/Vence:/)).toBeInTheDocument();
    expect(screen.getByText(/· Vencida/)).toBeInTheDocument();

    await user.click(screen.getByText("Descargar PDF"));
    expect(api.downloadFacturaPdf).toHaveBeenCalledWith(1, "FAC-00001");
  });

  it("una factura al día no muestra la marca de vencida en el detalle", async () => {
    const user = userEvent.setup();
    renderFacturas();
    await user.click(await screen.findByText("FAC-00002"));

    expect(await screen.findByText(/Vence:/)).toBeInTheDocument();
    expect(screen.queryByText(/· Vencida/)).not.toBeInTheDocument();
  });

  it("crear una factura envía la fecha de vencimiento cuando se indica", async () => {
    vi.mocked(api.getClients).mockResolvedValue([{ id: 1, name: "Cliente ACME" }] as any);
    vi.mocked(api.getProducts).mockResolvedValue([{ id: 1, name: "Bulto 25kg", unitPrice: 5000 }] as any);
    vi.mocked(api.createFactura).mockResolvedValue({ id: 3, invoiceNumber: "FAC-00003" } as any);

    const user = userEvent.setup();
    renderFacturas();
    await screen.findByRole("option", { name: "Cliente ACME" });

    await user.selectOptions(screen.getByDisplayValue("Cliente..."), "1");
    await user.selectOptions(screen.getByDisplayValue("Producto..."), "1");
    await user.type(screen.getByPlaceholderText("Cant."), "2");
    const dueDateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    await user.type(dueDateInput, "2026-12-31");
    await user.click(screen.getByText("Crear factura"));

    expect(api.createFactura).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 1, dueDate: "2026-12-31" })
    );
  });
});
