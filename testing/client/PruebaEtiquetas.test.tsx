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

  it("por defecto todas salen al tamaño del rollo cargado (100 × 75); por estación, las anchas salen giradas", async () => {
    renderPage();
    const sellado = (await screen.findByRole("cell", { name: "Bulto de Sellado" })).closest("tr")!;
    expect(within(sellado).getByText("16 × 8 cm")).toBeInTheDocument();
    expect(within(sellado).getByText(/10 × 7.5 cm · al 63%/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("radio", { name: /Cada estación a su tamaño/ }));
    expect(within(sellado).getByText(/8 × 16 cm · sale girada/)).toBeInTheDocument();
    const emb = screen.getByRole("cell", { name: "Rollo de Embobinado" }).closest("tr")!;
    // Embobinado entra derecho: la hoja es igual a su tamaño (sin girar ni achicar).
    expect(within(emb).getAllByText(/^10 × 8 cm$/, { selector: "td" })).toHaveLength(2);
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
    await user.click(screen.getByRole("radio", { name: /Cada estación a su tamaño/ }));
    await user.click(screen.getByRole("checkbox"));
    expect(getPrinterSettings()).toEqual({ sizeMode: "estacion", labelWidthMm: 100, labelHeightMm: 75, rotateWide: false, offsetXmm: 2, offsetYmm: 0 });
    expect(within(row).getByText(/16 × 8 cm/, { selector: "td:nth-child(3)" })).toBeInTheDocument();
    expect(within(row).getByText(/No entra en la impresora/)).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: /Imprimir prueba/ }));
    const html = win.document.write.mock.calls[0][0] as string;
    expect(html).toContain("BULTO SELLADO");
    expect(html).toContain("translate(2mm, 0mm)");
    expect(html).not.toContain("rotate(90deg)");
    open.mockRestore();
  });

  it("sin ajustes guardados: al tamaño del rollo (100 × 75), sin girar", () => {
    const html = rollLabelsHtml(
      [{ station: "sellado", code: "X", qrDataUrl: "data:x", orderNumber: "OP", productName: "P", weightKg: 1 }],
      "/logo.png"
    );
    expect(html).toContain("@page { size: 100mm 75mm; margin: 0; }");
    expect(html).not.toContain("rotate(90deg)");
  });
});
