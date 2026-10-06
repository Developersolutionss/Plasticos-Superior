import { test, expect } from "./support/fixtures";
import { EMAIL, llamar, type Rol } from "./support/api";

test.describe("inicio de sesión", () => {
  test("se inicia sesión por la pantalla, sobrevive a recargar y Salir la cierra", async ({ visitante }) => {
    const page = await visitante("/produccion/ordenes");
    await expect(page).toHaveURL(/\/login$/);

    await page.locator("#login-email").fill(EMAIL.produccion);
    await page.locator("#login-password").fill("password123");
    await page.getByRole("button", { name: "Ingresar" }).click();
    // Tras iniciar sesión vuelve a la pantalla que se había pedido.
    await expect(page).toHaveURL(/\/produccion\/ordenes$/);
    await expect(page.getByText("Gerente de Producción").first()).toBeVisible();

    await page.reload();
    await expect(page.getByText("Gerente de Producción").first()).toBeVisible();

    await page.getByText("Salir").click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/produccion/ordenes");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("una contraseña incorrecta no entra y lo dice", async ({ visitante }) => {
    const page = await visitante("/login");
    await page.locator("#login-email").fill(EMAIL.ventas);
    await page.locator("#login-password").fill("clave-equivocada");
    await page.getByRole("button", { name: "Ingresar" }).click();

    await expect(page.getByText("Credenciales inválidas")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("cinco intentos fallidos bloquean la cuenta aunque después se escriba la clave correcta", async ({ visitante }) => {
    // Se usa la cuenta de Precorte: ningún otro flujo la necesita (el bloqueo dura 15 minutos).
    const page = await visitante("/login");
    for (let intento = 1; intento <= 5; intento++) {
      await page.locator("#login-email").fill(EMAIL.precorte);
      await page.locator("#login-password").fill(`clave-mala-${intento}`);
      await page.getByRole("button", { name: "Ingresar" }).click();
      await expect(page.getByText(intento < 5 ? "Credenciales inválidas" : /bloqueada/)).toBeVisible();
    }

    await page.locator("#login-password").fill("password123");
    await page.getByRole("button", { name: "Ingresar" }).click();
    await expect(page.getByText(/Cuenta bloqueada/)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

// Cada rol ve solo su menú y, aunque conozca la URL o llame al API por fuera,
// no entra a lo que no es suyo: la pantalla lo redirige y el servidor responde 403.
const MATRIZ: { rol: Rol; ve: string; noVe: string; rutaVetada: string; apiVetada: string }[] = [
  { rol: "ventas", ve: "Pedidos", noVe: "Planeación", rutaVetada: "/produccion/ordenes", apiVetada: "/production-orders" },
  { rol: "extrusion", ve: "Despacho a bodegas", noVe: "Pedidos", rutaVetada: "/clientes", apiVetada: "/clients" },
  { rol: "calidad", ve: "Calidad", noVe: "Pedidos", rutaVetada: "/pedidos", apiVetada: "/pedidos" },
  { rol: "auditor", ve: "Trazabilidad", noVe: "Calidad", rutaVetada: "/clientes", apiVetada: "/clients" },
  { rol: "planeacion", ve: "Planeación", noVe: "Clientes", rutaVetada: "/clientes", apiVetada: "/pedidos" },
];

test.describe("lo que cada rol ve y puede abrir", () => {
  for (const { rol, ve, noVe, rutaVetada, apiVetada } of MATRIZ) {
    test(`${rol}: menú propio, URL ajena redirige y el API responde 403`, async ({ sesion }) => {
      const { page } = await sesion(rol, "/");
      await expect(page.getByText(ve, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(noVe, { exact: true })).toHaveCount(0);

      // La pantalla ajena no se abre: cada rol vuelve a su propio inicio.
      await page.goto(rutaVetada);
      await expect.poll(() => new URL(page.url()).pathname).not.toBe(rutaVetada);

      expect((await llamar(rol, "GET", apiVetada)).status).toBe(403);
    });
  }
});
