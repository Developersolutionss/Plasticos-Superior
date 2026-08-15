import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Exportaciones from "../../client/src/pages/Exportaciones";

vi.mock("../../client/src/api/client", () => ({
  api: { downloadExport: vi.fn() },
}));

import { api } from "../../client/src/api/client";

describe("Exportaciones", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista las 4 exportaciones disponibles", () => {
    render(<Exportaciones />);
    expect(screen.getByText("Inventario")).toBeInTheDocument();
    expect(screen.getByText("Pedidos")).toBeInTheDocument();
    expect(screen.getByText("Facturas")).toBeInTheDocument();
    expect(screen.getByText("Clientes")).toBeInTheDocument();
  });

  it("exportar inventario llama a la API con el recurso correcto", async () => {
    vi.mocked(api.downloadExport).mockResolvedValue(undefined as any);
    const user = userEvent.setup();
    render(<Exportaciones />);

    const inventarioCard = screen.getByText("Inventario").closest("div")!.parentElement!;
    await user.click(inventarioCard.querySelector("button")!);

    expect(api.downloadExport).toHaveBeenCalledWith("inventario");
  });

  it("un error de descarga muestra un mensaje", async () => {
    vi.mocked(api.downloadExport).mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<Exportaciones />);

    const facturasCard = screen.getByText("Facturas").closest("div")!.parentElement!;
    await user.click(facturasCard.querySelector("button")!);

    expect(await screen.findByText("No se pudo generar el archivo")).toBeInTheDocument();
  });
});
