import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Notificaciones from "../../client/src/pages/Notificaciones";

vi.mock("../../client/src/api/client", () => ({
  api: {
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn().mockResolvedValue({}),
    markAllNotificationsRead: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from "../../client/src/api/client";

const NOTIFICATIONS = [
  { id: 1, type: "op_pendiente_calidad", message: "OP #OP-00001 lista para revisión de calidad", link: "/calidad", read: false, createdAt: "2026-08-14T10:00:00Z" },
  { id: 2, type: "op_rechazada", message: "OP #OP-00002 fue rechazada en calidad", link: "/produccion/ordenes", read: true, createdAt: "2026-08-13T10:00:00Z" },
];

function renderNotificaciones() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/notificaciones"]}>
        <Notificaciones />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Notificaciones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getNotifications).mockResolvedValue(NOTIFICATIONS as any);
  });

  it("lista los mensajes de todas las notificaciones", async () => {
    renderNotificaciones();
    expect(await screen.findByText("OP #OP-00001 lista para revisión de calidad")).toBeInTheDocument();
    expect(screen.getByText("OP #OP-00002 fue rechazada en calidad")).toBeInTheDocument();
  });

  it("hacer clic en una no leída la marca como leída", async () => {
    const user = userEvent.setup();
    renderNotificaciones();
    await user.click(await screen.findByText("OP #OP-00001 lista para revisión de calidad"));
    expect(api.markNotificationRead).toHaveBeenCalledWith(1);
  });

  it("hacer clic en una ya leída no vuelve a marcarla", async () => {
    const user = userEvent.setup();
    renderNotificaciones();
    await user.click(await screen.findByText("OP #OP-00002 fue rechazada en calidad"));
    expect(api.markNotificationRead).not.toHaveBeenCalled();
  });

  it("Marcar todas como leídas llama a la API", async () => {
    const user = userEvent.setup();
    renderNotificaciones();
    await screen.findByText("OP #OP-00001 lista para revisión de calidad");
    await user.click(screen.getByText("Marcar todas como leídas"));
    expect(api.markAllNotificationsRead).toHaveBeenCalled();
  });

  it("cuando no hay notificaciones muestra el estado vacío", async () => {
    vi.mocked(api.getNotifications).mockResolvedValue([] as any);
    renderNotificaciones();
    expect(await screen.findByText("No tenés notificaciones.")).toBeInTheDocument();
  });
});
