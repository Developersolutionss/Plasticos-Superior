import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ThemeToggle from "../../client/src/components/ThemeToggle";
import { AuthProvider } from "../../client/src/auth/AuthContext";
import { ThemeProvider } from "../../client/src/theme/ThemeContext";

function renderToggle() {
  return render(
    <AuthProvider>
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>
    </AuthProvider>
  );
}

function setLoggedInUser(id: number) {
  localStorage.setItem("token", "test-token");
  localStorage.setItem("user", JSON.stringify({ id, name: `Usuario ${id}`, role: "super_admin", email: `u${id}@x.com` }));
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("un clic pasa a oscuro y aplica la clase dark al <html>", async () => {
    const user = userEvent.setup();
    renderToggle();

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    await user.click(screen.getByRole("button"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("persiste la preferencia en localStorage bajo una key propia (sin usuario logueado)", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button"));

    expect(localStorage.getItem("ps_theme:anon")).toBe("dark");
  });

  it("la preferencia se guarda por usuario, no compartida", async () => {
    setLoggedInUser(1);
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button"));

    expect(localStorage.getItem("ps_theme:1")).toBe("dark");
    expect(localStorage.getItem("ps_theme:anon")).toBeNull();
  });

  it("un segundo usuario en el mismo dispositivo no hereda el modo del primero", async () => {
    // Usuario 1 ya eligió oscuro en una sesión anterior.
    localStorage.setItem("ps_theme:1", "dark");

    setLoggedInUser(2);
    renderToggle();

    // Usuario 2 nunca eligió nada: arranca en "system" (claro, según el
    // mock de matchMedia en testing/client/setup.ts), no en el oscuro del 1.
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
