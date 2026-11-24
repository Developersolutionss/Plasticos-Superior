import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PruebaEtiquetas from "../../client/src/pages/PruebaEtiquetas";
import { getPrinterSettings, rollLabelsHtml } from "../../client/src/lib/rollLabels";

vi.mock("../../client/src/api/client", () => ({
  api: { getLabelSampleQr: vi.fn().mockResolvedValue({ qrDataUrl: "data:image/png;base64,QQQ" }), getPrinters: vi.fn().mockResolvedValue([]) },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PruebaEtiquetas />
    </QueryClientProvider>
  );
}

describe("Prueba de etiquetas", () => {
  beforeEach(() => localStorage.clear());

  it("lista cada etiqueta con su tamaño y el rollo a cargar en la SAT TT460 (las anchas salen giradas)", async () => {
    renderPage();
    const sellado = (await screen.findByRole("cell", { name: "Bulto de Sellado" })).closest("tr")!;
    expect(within(sellado).getByText("16 × 8 cm")).toBeInTheDocument();
    expect(within(sellado).getByText(/8 cm de ancho · sale girada/)).toBeInTheDocument();
    const emb = screen.getByRole("cell", { name: "Rollo de Embobinado" }).closest("tr")!;
    expect(within(emb).getByText("10 cm de ancho")).toBeInTheDocument();
  });

  it("imprime una muestra sin crear rollos, y los ajustes de este equipo se guardan y se aplican", async () => {
    const win = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn(), onload: null };
    const open = vi.spyOn(window, "open").mockReturnValue(win as any);
    renderPage();
    const user = userEvent.setup();
    const row = (await screen.findByRole("cell", { name: "Bulto de Sellado" })).closest("tr")!;
    await vi.waitFor(() => expect(within(row).getByRole("button", { name: /Imprimir prueba/ })).toBeEnabled());

    // Se puede teclear un negativo (antes "-" se volvía 0 y quedaba "05").
    const y = screen.getByLabelText("Correr hacia abajo (mm)");
    await user.clear(y);
    await user.type(y, "-1.5");
    expect(getPrinterSettings().offsetYmm).toBe(-1.5);
    await user.clear(y);
    await user.type(y, "0");
    const x = screen.getByLabelText("Correr a la derecha (mm)");
    await user.clear(x);
    await user.type(x, "2");
    await user.click(screen.getByRole("checkbox"));
    expect(getPrinterSettings()).toEqual({ rotateWide: false, offsetXmm: 2, offsetYmm: 0 });
    expect(within(row).getByText("16 cm de ancho")).toBeInTheDocument();
    expect(within(row).getByText(/No entra en la impresora/)).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: /Imprimir prueba/ }));
    const html = win.document.write.mock.calls[0][0] as string;
    expect(html).toContain("BULTO SELLADO");
    expect(html).toContain("translate(2mm, 0mm)");
    expect(html).not.toContain("rotate(90deg)");
    open.mockRestore();
  });

  it("sin ajustes guardados: gira las anchas y no corre nada", () => {
    const html = rollLabelsHtml(
      [{ station: "sellado", code: "X", qrDataUrl: "data:x", orderNumber: "OP", productName: "P", weightKg: 1 }],
      "/logo.png"
    );
    expect(html).toContain("transform: translateX(80mm) rotate(90deg)");
    expect(html).not.toContain("translate(0mm");
  });
});
