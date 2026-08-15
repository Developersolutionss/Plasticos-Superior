import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Usuarios from "../../client/src/pages/Usuarios";

vi.mock("../../client/src/api/client", () => ({
  api: {
    getUsers: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from "../../client/src/api/client";

const USERS = [
  { id: 1, name: "Ana Admin", email: "ana@empresa.com", role: "admin", active: true },
  { id: 2, name: "Carlos Calidad", email: "carlos@empresa.com", role: "calidad", active: false },
];

function renderUsuarios() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Usuarios />
    </QueryClientProvider>
  );
}

/** La página renderiza tabla (desktop) y tarjetas (móvil) a la vez — jsdom
 * no aplica `hidden md:table` / `md:hidden`, así que ambas quedan en el
 * DOM. Se escopea a la tabla para evitar matches duplicados. */
async function findTable() {
  return screen.findByRole("table");
}

describe("Usuarios", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getUsers).mockResolvedValue(USERS as any);
  });

  it("lista los usuarios con su rol traducido y estado", async () => {
    renderUsuarios();
    const table = within(await findTable());
    expect(table.getByText("Ana Admin")).toBeInTheDocument();
    expect(table.getByText("Admin")).toBeInTheDocument();
    expect(table.getByText("Calidad")).toBeInTheDocument();
    expect(table.getByText("Activo")).toBeInTheDocument();
    expect(table.getByText("Inactivo")).toBeInTheDocument();
  });

  it("desactivar exige confirmación en dos pasos", async () => {
    vi.mocked(api.deactivateUser).mockResolvedValue({} as any);
    const user = userEvent.setup();
    renderUsuarios();
    const table = within(await findTable());

    await user.click(table.getByText("Desactivar"));
    expect(api.deactivateUser).not.toHaveBeenCalled();

    await user.click(table.getByText("Confirmar"));
    expect(api.deactivateUser).toHaveBeenCalledWith(1);
  });

  it("muestra un mensaje claro si el servidor rechaza la autodesactivación", async () => {
    vi.mocked(api.deactivateUser).mockRejectedValue(new Error("No podés desactivar tu propio usuario"));
    const user = userEvent.setup();
    renderUsuarios();
    const table = within(await findTable());

    await user.click(table.getByText("Desactivar"));
    await user.click(table.getByText("Confirmar"));

    expect(await screen.findByText("No podés desactivar tu propio usuario.")).toBeInTheDocument();
  });

  it("reactiva un usuario inactivo", async () => {
    const user = userEvent.setup();
    renderUsuarios();
    const table = within(await findTable());

    await user.click(table.getByText("Reactivar"));
    expect(api.reactivateUser).toHaveBeenCalledWith(2);
  });

  it("abre el modal de creación al hacer clic en Nuevo usuario", async () => {
    const user = userEvent.setup();
    renderUsuarios();
    await findTable();

    await user.click(screen.getByText("Nuevo usuario"));
    expect(screen.getByText("Crear usuario")).toBeInTheDocument();
  });
});
