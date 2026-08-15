import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotificationBell from "../../client/src/components/NotificationBell";

vi.mock("../../client/src/api/client", () => ({
  api: {
    getUnreadNotificationCount: vi.fn(),
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn().mockResolvedValue({}),
    markAllNotificationsRead: vi.fn().mockResolvedValue({}),
  },
}));

import { api } from "../../client/src/api/client";

function renderBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getNotifications).mockResolvedValue([
      { id: 1, message: "OP #OP-00001 lista para revisión de calidad", link: "/calidad", read: false, createdAt: "2026-08-14T10:00:00Z" },
    ] as any);
  });

  it("muestra el badge con el conteo de no leídas", async () => {
    vi.mocked(api.getUnreadNotificationCount).mockResolvedValue({ count: 3 } as any);
    renderBell();
    expect(await screen.findByText("3")).toBeInTheDocument();
  });

  it("con más de 9 no leídas muestra 9+", async () => {
    vi.mocked(api.getUnreadNotificationCount).mockResolvedValue({ count: 12 } as any);
    renderBell();
    expect(await screen.findByText("9+")).toBeInTheDocument();
  });

  it("sin no leídas no muestra badge", async () => {
    vi.mocked(api.getUnreadNotificationCount).mockResolvedValue({ count: 0 } as any);
    renderBell();
    await screen.findByTitle("Notificaciones");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("clic en la campana abre el listado de notificaciones", async () => {
    vi.mocked(api.getUnreadNotificationCount).mockResolvedValue({ count: 1 } as any);
    const user = userEvent.setup();
    renderBell();
    await user.click(await screen.findByTitle("Notificaciones"));
    expect(await screen.findByText("OP #OP-00001 lista para revisión de calidad")).toBeInTheDocument();
  });
});
