import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Exportaciones from "../../client/src/pages/Exportaciones";

vi.mock("../../client/src/api/client", () => ({
  api: { downloadExport: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { api, ApiError } from "../../client/src/api/client";

describe("Exportaciones", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lista las exportaciones de producción, inventario y ventas", () => {
    render(<Exportaciones />);
    for (const label of [
      "Órdenes de producción",
      "Rollos",
      "Despachos a bodegas",
      "Materia prima",
      "Inventario",
      "Movimientos de inventario",
      "Pedidos",
      "Facturas",
      "Clientes",
    ]) {
      expect(screen.getByRole("button", { name: `Exportar ${label}` })).toBeInTheDocument();
    }
  });

  it("sin fechas exporta todo; el inventario nunca manda fechas", async () => {
    vi.mocked(api.downloadExport).mockResolvedValue(undefined as any);
    const user = userEvent.setup();
    render(<Exportaciones />);

    await user.click(screen.getByRole("button", { name: "Exportar Rollos" }));
    expect(api.downloadExport).toHaveBeenCalledWith("rollos", { desde: "", hasta: "" });

    await user.type(screen.getByLabelText("Desde"), "2026-11-01");
    await user.click(screen.getByRole("button", { name: "Exportar Inventario" }));
    expect(api.downloadExport).toHaveBeenLastCalledWith("inventario", {});
  });

  it("con fechas, las manda en las exportaciones que tienen fecha", async () => {
    vi.mocked(api.downloadExport).mockResolvedValue(undefined as any);
    const user = userEvent.setup();
    render(<Exportaciones />);

    await user.type(screen.getByLabelText("Desde"), "2026-11-01");
    await user.type(screen.getByLabelText("Hasta"), "2026-11-30");
    await user.click(screen.getByRole("button", { name: "Exportar Órdenes de producción" }));
    expect(api.downloadExport).toHaveBeenCalledWith("ordenes-produccion", { desde: "2026-11-01", hasta: "2026-11-30" });
  });

  it("un error de descarga muestra el mensaje del servidor", async () => {
    vi.mocked(api.downloadExport).mockRejectedValue(new ApiError("La fecha 'desde' es posterior a 'hasta'", 400));
    const user = userEvent.setup();
    render(<Exportaciones />);

    await user.click(screen.getByRole("button", { name: "Exportar Facturas" }));
    expect(await screen.findByText("No se pudo generar el archivo: La fecha 'desde' es posterior a 'hasta'")).toBeInTheDocument();
  });
});
