import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PrintOnPrinter from "../../client/src/components/PrintOnPrinter";

vi.mock("../../client/src/api/client", () => ({
  api: { getPrinters: vi.fn(), printRollLabelsOn: vi.fn(), printTestLabelOn: vi.fn(), getPrintJobs: vi.fn() },
}));
import { api } from "../../client/src/api/client";

const printer = (over: object) => ({
  id: 1, name: "SAT TT460", labelWidthMm: 100, labelHeightMm: 75, dpi: 203, stations: [] as string[], active: true, lastSeenAt: null, agentInfo: null, online: true, ...over,
});

function renderButton(props: Parameters<typeof PrintOnPrinter>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PrintOnPrinter {...props} />
    </QueryClientProvider>
  );
}

describe("imprimir en la impresora de planta (desde el celular)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("sin impresoras configuradas no muestra nada", async () => {
    vi.mocked(api.getPrinters).mockResolvedValue([]);
    const { container } = renderButton({ rolls: [{ rollId: 1, token: "T" }] });
    await vi.waitFor(() => expect(api.getPrinters).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("manda los rollos con su token a la impresora de la estación y muestra cuando salen", async () => {
    vi.mocked(api.getPrinters).mockResolvedValue([printer({ id: 1, name: "Principal" }), printer({ id: 2, name: "Sellado", stations: ["sellado"] })]);
    vi.mocked(api.printRollLabelsOn).mockResolvedValue({
      jobs: [
        { id: 7, description: "SELL-1", status: "pendiente" },
        { id: 8, description: "SELL-2", status: "pendiente" },
      ],
    });
    vi.mocked(api.getPrintJobs).mockResolvedValue([
      { id: 7, description: "SELL-1", status: "impreso" },
      { id: 8, description: "SELL-2", status: "impreso" },
    ]);
    renderButton({ station: "sellado", rolls: [{ rollId: 1, token: "A" }, { rollId: 2, token: "B" }] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Imprimir 2 en Sellado" }));
    expect(api.printRollLabelsOn).toHaveBeenCalledWith(2, [{ rollId: 1, token: "A" }, { rollId: 2, token: "B" }]);
    expect(await screen.findByText(/2 impresas/, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(localStorage.getItem("lastLabelPrinterId")).toBe("2");
  });

  it("avisa si la impresora está fuera de línea y muestra el error del puente", async () => {
    vi.mocked(api.getPrinters).mockResolvedValue([printer({ online: false })]);
    vi.mocked(api.printTestLabelOn).mockResolvedValue({ jobs: [{ id: 9, description: "Prueba", status: "pendiente" }] });
    vi.mocked(api.getPrintJobs).mockResolvedValue([{ id: 9, description: "Prueba", status: "error", error: "Sin papel" }]);
    renderButton({ testStation: "precorte", label: "Imprimir prueba" });
    expect(await screen.findByText(/fuera de línea/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Imprimir prueba" }));
    expect(api.printTestLabelOn).toHaveBeenCalledWith(1, "precorte");
    expect(await screen.findByText(/no se imprimió: Sin papel/, {}, { timeout: 4000 })).toBeInTheDocument();
  });
});
