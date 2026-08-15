import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "../../server/src/routes/auth";
import { clientsRouter } from "../../server/src/routes/clients";
import { inventoryRouter } from "../../server/src/routes/inventory";
import { productionRouter } from "../../server/src/routes/production";
import { dispatchesRouter } from "../../server/src/routes/dispatches";
import { whatsappWebhookRouter } from "../../server/src/routes/whatsappWebhook";
import { productsRouter } from "../../server/src/routes/products";
import { usersRouter } from "../../server/src/routes/users";
import { notificationsRouter } from "../../server/src/routes/notifications";
import { dashboardRouter } from "../../server/src/routes/dashboard";
import { exportRouter } from "../../server/src/routes/export";
import { facturasRouter } from "../../server/src/routes/facturas";
import { cotizacionesRouter } from "../../server/src/routes/cotizaciones";
import { warehouseRouter } from "../../server/src/routes/warehouse";
import { prisma } from "../../server/src/prisma";
import { redistributeScores, boostValue, isHot, nextCycle, nextVisitState, HOT_THRESHOLD } from "../../server/src/services/frequency";

let server: Server;
let baseUrl = "";
let token = "";
let gerenteToken = "";
let almacenToken = "";
let ventasToken = "";

const authHeaders = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const headersFor = (t: string) => ({ Authorization: `Bearer ${t}`, "Content-Type": "application/json" });

async function loginAs(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  assert.equal(res.status, 200, `Los tests requieren el seed aplicado (${email} / password123)`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function buildApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRouter);
  app.use("/api/clients", clientsRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/production", productionRouter);
  app.use("/api/dispatches", dispatchesRouter);
  app.use("/webhook/whatsapp", whatsappWebhookRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/facturas", facturasRouter);
  app.use("/api/cotizaciones", cotizacionesRouter);
  app.use("/api/warehouse", warehouseRouter);
  return app;
}

before(async () => {
  const app = buildApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@empresa.com", password: "password123" }),
  });
  assert.equal(res.status, 200, "Los tests requieren el seed aplicado (admin@empresa.com / password123)");
  const body = (await res.json()) as { token: string };
  token = body.token;

  gerenteToken = await loginAs("produccion@empresa.com");
  almacenToken = await loginAs("despacho@empresa.com");
  ventasToken = await loginAs("ventas@empresa.com");
});

after(async () => {
  await prisma.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("health", () => {
  it("responde ok sin autenticación", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

describe("auth", () => {
  it("login válido devuelve token y rol super_admin", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@empresa.com", password: "password123" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { token: string; user: { role: string } };
    assert.ok(body.token);
    assert.equal(body.user.role, "super_admin");
  });

  it("password incorrecto devuelve 401", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@empresa.com", password: "incorrecta" }),
    });
    assert.equal(res.status, 401);
  });

  it("body inválido devuelve 400", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "no-es-email", password: "123" }),
    });
    assert.equal(res.status, 400);
  });
});

describe("protección de rutas", () => {
  it("devuelve 401 sin token", async () => {
    const res = await fetch(`${baseUrl}/api/clients`);
    assert.equal(res.status, 401);
  });

  it("devuelve 401 con token inválido", async () => {
    const res = await fetch(`${baseUrl}/api/clients`, {
      headers: { Authorization: "Bearer token-invalido" },
    });
    assert.equal(res.status, 401);
  });
});

describe("clientes", () => {
  it("lista clientes activos con seed", async () => {
    const res = await fetch(`${baseUrl}/api/clients`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const clients = (await res.json()) as { name: string }[];
    assert.ok(clients.some((c) => c.name === "Cliente ACME"));
  });

  it("crea un cliente", async () => {
    const res = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "TEST-Client", contactInfo: {} }),
    });
    assert.equal(res.status, 201);
    const client = (await res.json()) as { id: number };
    await prisma.client.delete({ where: { id: client.id } });
  });
});

describe("inventario", () => {
  it("lista productos del catálogo", async () => {
    const res = await fetch(`${baseUrl}/api/inventory/products`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const products = (await res.json()) as { sku: string }[];
    assert.ok(products.some((p) => p.sku === "BUL-001"));
  });

  it("devuelve stock por categoría", async () => {
    const res = await fetch(`${baseUrl}/api/inventory`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const stock = (await res.json()) as unknown[];
    assert.ok(Array.isArray(stock));
  });

  it("devuelve alertas de stock bajo mínimo", async () => {
    const res = await fetch(`${baseUrl}/api/inventory/alerts`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const alerts = (await res.json()) as unknown[];
    assert.ok(Array.isArray(alerts));
  });
});

describe("despachos", () => {
  it("lista despachos", async () => {
    const res = await fetch(`${baseUrl}/api/dispatches`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const dispatches = (await res.json()) as unknown[];
    assert.ok(Array.isArray(dispatches));
  });

  it("crea un despacho con items (prisma nested create) y lo limpia", async () => {
    const clientsRes = await fetch(`${baseUrl}/api/clients`, { headers: authHeaders() });
    const clients = (await clientsRes.json()) as { id: number }[];
    const product = await prisma.product.findFirst({ where: { sku: "BUL-001" } });
    assert.ok(product, "Falta el producto BUL-001 en el catálogo");

    const res = await fetch(`${baseUrl}/api/dispatches`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        clientId: clients[0].id,
        items: [{ productId: product!.id, quantityRequested: 5 }],
      }),
    });
    assert.equal(res.status, 201);
    const dispatch = (await res.json()) as { id: number; items: unknown[] };
    assert.equal(dispatch.items.length, 1);

    await prisma.dispatchItem.deleteMany({ where: { dispatchId: dispatch.id } });
    await prisma.dispatch.delete({ where: { id: dispatch.id } });
  });
});

describe("contactos", () => {
  let clientId = 0;
  const created: number[] = [];

  before(async () => {
    const res = await fetch(`${baseUrl}/api/clients`, { headers: authHeaders() });
    const clients = (await res.json()) as { id: number; name: string }[];
    const acme = clients.find((c) => c.name === "Cliente ACME") ?? clients[0];
    clientId = acme.id;
  });

  after(async () => {
    for (const id of created) {
      await fetch(`${baseUrl}/api/clients/${clientId}/contacts/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }).catch(() => {});
    }
  });

  it("lista contactos del cliente", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const contacts = (await res.json()) as unknown[];
    assert.ok(Array.isArray(contacts));
  });

  it("404 para cliente inexistente", async () => {
    const res = await fetch(`${baseUrl}/api/clients/99999999/contacts`, { headers: authHeaders() });
    assert.equal(res.status, 404);
  });

  it("400 para id de cliente inválido", async () => {
    const res = await fetch(`${baseUrl}/api/clients/abc/contacts`, { headers: authHeaders() });
    assert.equal(res.status, 400);
  });

  it("400 para email inválido", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Test", email: "no-es-email" }),
    });
    assert.equal(res.status, 400);
  });

  it("crea un contacto no principal", async () => {
    const name = `TEST-A-${Date.now()}`;
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, isPrimary: false }),
    });
    assert.equal(res.status, 201);
    const contact = (await res.json()) as { id: number; isPrimary: boolean };
    assert.equal(contact.isPrimary, false);
    created.push(contact.id);
  });

  it("crear un contacto principal desmarca al anterior", async () => {
    const name = `TEST-B-${Date.now()}`;
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, isPrimary: true }),
    });
    assert.equal(res.status, 201);
    const contact = (await res.json()) as { id: number; isPrimary: boolean };
    assert.equal(contact.isPrimary, true);
    created.push(contact.id);

    const listRes = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, { headers: authHeaders() });
    const contacts = (await listRes.json()) as { name: string; isPrimary: boolean }[];
    const a = contacts.find((c) => c.name.startsWith("TEST-A-"));
    const b = contacts.find((c) => c.name === name);
    assert.ok(a && b);
    assert.equal(a!.isPrimary, false, "El contacto anterior debió quedar desmarcado");
    assert.equal(b!.isPrimary, true);
  });

  it("borrar el principal reasigna al más reciente", async () => {
    const listBefore = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, { headers: authHeaders() });
    const before = (await listBefore.json()) as { id: number; name: string; isPrimary: boolean }[];
    const b = before.find((c) => c.name.startsWith("TEST-B-"));
    const a = before.find((c) => c.name.startsWith("TEST-A-"));
    assert.ok(b && b.isPrimary, "Debe existir el contacto principal TEST-B");

    const res = await fetch(`${baseUrl}/api/clients/${clientId}/contacts/${b!.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    assert.equal(res.status, 200);

    const listAfter = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, { headers: authHeaders() });
    const after = (await listAfter.json()) as { id: number; name: string; isPrimary: boolean }[];
    const aAfter = after.find((c) => c.id === a!.id);
    assert.equal(aAfter!.isPrimary, true, "El contacto más reciente restante debió quedar como principal");
  });

  it("PATCH edita datos y al marcar principal desmarca a los demás", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: `TEST-EDIT-${Date.now()}`, isPrimary: false, position: "Vendedor" }),
    });
    assert.equal(res.status, 201);
    const contact = (await res.json()) as { id: number };
    created.push(contact.id);

    const patch = await fetch(`${baseUrl}/api/clients/${clientId}/contacts/${contact.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "TEST-EDIT Renombrado", position: "Gerente", phone: "123", email: "e@x.com", isPrimary: true }),
    });
    assert.equal(patch.status, 200);
    const updated = (await patch.json()) as { name: string; position: string; phone: string; email: string; isPrimary: boolean };
    assert.equal(updated.name, "TEST-EDIT Renombrado");
    assert.equal(updated.position, "Gerente");
    assert.equal(updated.phone, "123");
    assert.equal(updated.email, "e@x.com");
    assert.equal(updated.isPrimary, true);

    const listRes = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, { headers: authHeaders() });
    const list = (await listRes.json()) as { name: string; isPrimary: boolean }[];
    const prev = list.find((c) => c.name.startsWith("TEST-A-") && !c.name.includes("Renombrado"));
    assert.equal(prev?.isPrimary, false, "El principal anterior debió quedar desmarcado");
  });

  it("PATCH valida y responde 404 si el contacto no existe", async () => {
    const bad = await fetch(`${baseUrl}/api/clients/${clientId}/contacts/99999999`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "X" }),
    });
    assert.equal(bad.status, 404);

    const badBody = await fetch(`${baseUrl}/api/clients/${clientId}/contacts/${created[0] ?? 1}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "" }),
    });
    assert.equal(badBody.status, 400);
  });
});

describe("clientes · nuevo CRM (edición, visitas, avatar, lista global)", () => {
  let clientId = 0;

  before(async () => {
    const res = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "TEST-CRM" }),
    });
    assert.equal(res.status, 201);
    const client = (await res.json()) as { id: number };
    clientId = client.id;
  });

  after(async () => {
    await prisma.client.delete({ where: { id: clientId } }).catch(() => {});
  });

  it("PATCH /:id edita nombre, contactInfo y creditLimit", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${clientId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ name: "TEST-CRM Editado", contactInfo: { email: "x@y.com", notes: "n" }, creditLimit: 5000 }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { name: string; contactInfo: { email: string; phone?: string }; creditLimit: string };
    assert.equal(body.name, "TEST-CRM Editado");
    assert.equal(body.contactInfo.email, "x@y.com");
    assert.equal(Number(body.creditLimit), 5000);
  });

  it("POST /:id/visit incrementa viewCount y setea lastViewedAt", async () => {
    const antes = await prisma.client.findUnique({ where: { id: clientId } });
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/visit`, { method: "POST", headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { viewCount: number; lastViewedAt: string };
    const despues = await prisma.client.findUnique({ where: { id: clientId } });
    assert.equal(body.viewCount, (antes!.viewCount ?? 0) + 1);
    assert.equal(despues!.viewCount, (antes!.viewCount ?? 0) + 1);
    assert.ok(body.lastViewedAt);
  });

  it("POST /:id/visit con racha en el umbral hace boost en vivo a máximo+1", async () => {
    // Un cliente con 4 interacciones en la semana: la siguiente visita cruza el
    // umbral (5) y sube el viewCount al máximo actual + 1, no solo +1.
    await prisma.client.update({
      where: { id: clientId },
      data: { cycleInteractions: HOT_THRESHOLD - 1, viewCount: 0 },
    });
    const antes = await prisma.client.aggregate({ _max: { viewCount: true } });

    const res = await fetch(`${baseUrl}/api/clients/${clientId}/visit`, { method: "POST", headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { viewCount: number; cycleInteractions: number };
    assert.equal(body.cycleInteractions, 0, "el boost se consume: las interacciones vuelven a 0");
    assert.equal(body.viewCount, (antes._max.viewCount ?? 0) + 1, "el boost sube al máximo + 1");

    // La siguiente visita ya no cruza el umbral: solo +1 (necesita 5 nuevas).
    const segunda = await fetch(`${baseUrl}/api/clients/${clientId}/visit`, { method: "POST", headers: authHeaders() });
    const body2 = (await segunda.json()) as { viewCount: number; cycleInteractions: number };
    assert.equal(body2.viewCount, body.viewCount + 1, "sin boost: solo incrementa en +1");
    assert.equal(body2.cycleInteractions, 1, "arranca de nuevo el conteo de interacciones");
  });

  it("POST /clients crea el cliente arriba del ranking (máximo+1 y hot)", async () => {
    const antes = await prisma.client.aggregate({ _max: { viewCount: true } });
    const res = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "TEST-BOOST-CREATE" }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: number; viewCount: number; cycleInteractions: number };
    assert.equal(body.viewCount, (antes._max.viewCount ?? 0) + 1);
    assert.equal(body.cycleInteractions, HOT_THRESHOLD, "nace 'hot'");
    await prisma.client.delete({ where: { id: body.id } });
  });

  it("POST /contacts/:id/visit incrementa la frecuencia DEL CONTACTO (independiente del cliente)", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "TEST-CONTACT-FREQ" }),
    });
    assert.equal(res.status, 201);
    const contact = (await res.json()) as { id: number; viewCount: number; cycleInteractions: number; clientId: number };

    const clientAntes = (await prisma.client.findUnique({ where: { id: clientId } }))?.viewCount ?? 0;

    const visit = await fetch(`${baseUrl}/api/clients/contacts/${contact.id}/visit`, { method: "POST", headers: authHeaders() });
    assert.equal(visit.status, 200);
    const body = (await visit.json()) as { viewCount: number; cycleInteractions: number };
    assert.equal(body.viewCount, (contact.viewCount ?? 0) + 1, "la visita cruza el umbral del contacto: sube +1 sobre su conteo");

    const clientDespues = (await prisma.client.findUnique({ where: { id: clientId } }))?.viewCount ?? 0;
    assert.equal(clientDespues, clientAntes, "la visita del contacto NO toca la frecuencia del cliente");

    await prisma.clientContact.delete({ where: { id: contact.id } });
  });

  it("POST /contacts/:id/visit: umbral → boost a máximo+1 y consume (necesita 5 frescas)", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/contacts`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "TEST-CONTAC-FRESH" }),
    });
    const contact = (await res.json()) as { id: number };

    await prisma.clientContact.update({
      where: { id: contact.id },
      data: { cycleInteractions: HOT_THRESHOLD - 1, viewCount: 0 },
    });
    const antesMax = await prisma.clientContact.aggregate({ _max: { viewCount: true } });

    const primera = await fetch(`${baseUrl}/api/clients/contacts/${contact.id}/visit`, { method: "POST", headers: authHeaders() });
    const b1 = (await primera.json()) as { viewCount: number; cycleInteractions: number };
    assert.equal(b1.viewCount, (antesMax._max.viewCount ?? 0) + 1, "cruza el umbral: boost a máximo+1");
    assert.equal(b1.cycleInteractions, 0, "boost consumido");

    const segunda = await fetch(`${baseUrl}/api/clients/contacts/${contact.id}/visit`, { method: "POST", headers: authHeaders() });
    const b2 = (await segunda.json()) as { viewCount: number; cycleInteractions: number };
    assert.equal(b2.viewCount, b1.viewCount + 1, "sin umbral: solo +1");
    assert.equal(b2.cycleInteractions, 1);

    await prisma.clientContact.delete({ where: { id: contact.id } });
  });

  it("GET /contacts devuelve contactos con empresa relacionada", async () => {
    const res = await fetch(`${baseUrl}/api/clients/contacts`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const contacts = (await res.json()) as {
      name: string;
      viewCount?: number;
      cycleInteractions?: number;
      client: { id: number; name: string } | null;
    }[];
    assert.ok(Array.isArray(contacts));
    assert.ok(contacts.length > 0, "El seed incluye contactos");
    assert.ok(contacts.every((c) => c.client && typeof c.client.name === "string"));
    // La frecuencia es propia del contacto: el listado expone sus contadores.
    assert.ok(contacts.every((c) => typeof c.viewCount === "number" && typeof c.cycleInteractions === "number"));
  });

  it("POST /:id/avatar rechaza un archivo que no es imagen", async () => {
    const form = new FormData();
    form.append("avatar", new Blob(["texto"], { type: "text/plain" }));
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    assert.equal(res.status, 400);
  });

  it("POST /:id/avatar sube un PNG válido y setea avatarUrl", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64"
    );
    const form = new FormData();
    form.append("avatar", new File([png as any], "avatar.png", { type: "image/png" }));
    const res = await fetch(`${baseUrl}/api/clients/${clientId}/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const bodyText = await res.text();
    assert.equal(res.status, 200, `avatar PNG reply: ${bodyText}`);
    const body = JSON.parse(bodyText) as { avatarUrl: string };
    assert.ok(body.avatarUrl.startsWith("/api/uploads/clients/"));

    const stored = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "server",
      "uploads",
      "clients",
      path.basename(body.avatarUrl)
    );
    assert.ok(fs.existsSync(stored), "El archivo debe existir en disco");
    fs.rmSync(stored, { force: true });

    await prisma.client.update({ where: { id: clientId }, data: { avatarUrl: null } });
  });

  it("DELETE /:id desactiva el cliente", async () => {
    const res = await fetch(`${baseUrl}/api/clients/${clientId}`, { method: "DELETE", headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { active: boolean };
    assert.equal(body.active, false);
    const enDb = await prisma.client.findUnique({ where: { id: clientId } });
    assert.equal(enDb!.active, false);
    // Ya no aparece en el listado (solo clientes activos).
    const list = (await (await fetch(`${baseUrl}/api/clients`, { headers: authHeaders() })).json()) as { id: number }[];
    assert.ok(!list.some((c) => c.id === clientId));
  });
});

describe("productos", () => {
  it("crea un producto con el rol correcto, rechaza el rol incorrecto, y rechaza SKU duplicado", async () => {
    const sku = `TEST-SKU-${Date.now()}`;
    const forbidden = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor(almacenToken),
      body: JSON.stringify({ sku, name: "Producto de test", category: "bultos", unit: "unidad", minStock: 1, unitPrice: 100 }),
    });
    assert.equal(forbidden.status, 403);

    const res = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor(gerenteToken),
      body: JSON.stringify({ sku, name: "Producto de test", category: "bultos", unit: "unidad", minStock: 1, unitPrice: 100 }),
    });
    assert.equal(res.status, 201);
    const product = (await res.json()) as { id: number };

    const dup = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor(gerenteToken),
      body: JSON.stringify({ sku, name: "Otro", category: "bultos", unit: "unidad", minStock: 1, unitPrice: 100 }),
    });
    assert.equal(dup.status, 409);

    await prisma.product.delete({ where: { id: product.id } });
  });

  it("edita, desactiva y reactiva un producto — desactivado sale del selector filtrado pero no del catálogo completo", async () => {
    const sku = `TEST-SKU-${Date.now()}-2`;
    const created = (await (
      await fetch(`${baseUrl}/api/products`, {
        method: "POST",
        headers: headersFor(gerenteToken),
        body: JSON.stringify({ sku, name: "Producto B", category: "bultos", unit: "unidad", minStock: 1, unitPrice: 100 }),
      })
    ).json()) as { id: number };

    const patched = await fetch(`${baseUrl}/api/products/${created.id}`, {
      method: "PATCH",
      headers: headersFor(gerenteToken),
      body: JSON.stringify({ name: "Producto B editado" }),
    });
    assert.equal(patched.status, 200);

    const deactivated = await fetch(`${baseUrl}/api/products/${created.id}`, { method: "DELETE", headers: headersFor(gerenteToken) });
    assert.equal(deactivated.status, 200);
    assert.equal(((await deactivated.json()) as { active: boolean }).active, false);

    const filtered = (await (await fetch(`${baseUrl}/api/inventory/products`, { headers: authHeaders() })).json()) as { id: number }[];
    assert.ok(!filtered.some((p) => p.id === created.id));
    const full = (await (await fetch(`${baseUrl}/api/products`, { headers: authHeaders() })).json()) as { id: number }[];
    assert.ok(full.some((p) => p.id === created.id));

    const reactivated = await fetch(`${baseUrl}/api/products/${created.id}/reactivate`, { method: "POST", headers: headersFor(gerenteToken) });
    assert.equal(reactivated.status, 200);
    assert.equal(((await reactivated.json()) as { active: boolean }).active, true);

    await prisma.product.delete({ where: { id: created.id } });
  });
});

describe("usuarios", () => {
  it("crea un usuario con el rol correcto, rechaza el rol incorrecto, y rechaza email duplicado", async () => {
    const email = `test-user-${Date.now()}@empresa.com`;
    const forbidden = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: headersFor(gerenteToken),
      body: JSON.stringify({ name: "Test User", email, password: "testpass123", role: "ventas_pedidos" }),
    });
    assert.equal(forbidden.status, 403);

    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Test User", email, password: "testpass123", role: "ventas_pedidos" }),
    });
    assert.equal(res.status, 201);
    const user = (await res.json()) as { id: number };

    const dup = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Otro", email, password: "testpass123", role: "ventas_pedidos" }),
    });
    assert.equal(dup.status, 409);

    await prisma.user.delete({ where: { id: user.id } });
  });

  it("un admin no puede desactivarse a sí mismo; desactivar bloquea el login y reactivar lo devuelve", async () => {
    const me = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@empresa.com", password: "password123" }),
    });
    const meBody = (await me.json()) as { user: { id: number } };

    const selfDeactivate = await fetch(`${baseUrl}/api/users/${meBody.user.id}`, { method: "DELETE", headers: authHeaders() });
    assert.equal(selfDeactivate.status, 400);

    const email = `test-deact-${Date.now()}@empresa.com`;
    const created = (await (
      await fetch(`${baseUrl}/api/users`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "Test Deact", email, password: "testpass123", role: "ventas_pedidos" }),
      })
    ).json()) as { id: number };

    const deactivated = await fetch(`${baseUrl}/api/users/${created.id}`, { method: "DELETE", headers: authHeaders() });
    assert.equal(deactivated.status, 200);

    const loginBlocked = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "testpass123" }),
    });
    assert.equal(loginBlocked.status, 401);

    const reactivated = await fetch(`${baseUrl}/api/users/${created.id}/reactivate`, { method: "POST", headers: authHeaders() });
    assert.equal(reactivated.status, 200);

    const loginOk = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "testpass123" }),
    });
    assert.equal(loginOk.status, 200);

    await prisma.user.delete({ where: { id: created.id } });
  });
});

describe("notificaciones", () => {
  it("lista, cuenta, marca como leída (propia sí, ajena no) y marca todas", async () => {
    const me = (await (
      await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders() })
    ).json()) as { id: number };
    const otherUser = await prisma.user.findFirst({ where: { email: "ventas@empresa.com" } });

    const notif = await prisma.notification.create({
      data: { userId: me.id, type: "test", message: "TEST-notificación", read: false },
    });

    const list = (await (await fetch(`${baseUrl}/api/notifications`, { headers: authHeaders() })).json()) as { id: number }[];
    assert.ok(list.some((n) => n.id === notif.id));

    const countBefore = (await (
      await fetch(`${baseUrl}/api/notifications/unread-count`, { headers: authHeaders() })
    ).json()) as { count: number };
    assert.ok(countBefore.count >= 1);

    const foreignAttempt = await fetch(`${baseUrl}/api/notifications/${notif.id}/read`, {
      method: "PATCH",
      headers: headersFor(ventasToken),
    });
    assert.equal(foreignAttempt.status, 404);

    const markRead = await fetch(`${baseUrl}/api/notifications/${notif.id}/read`, { method: "PATCH", headers: authHeaders() });
    assert.equal(markRead.status, 200);
    assert.equal(((await markRead.json()) as { read: boolean }).read, true);

    const markAll = await fetch(`${baseUrl}/api/notifications/read-all`, { method: "PATCH", headers: authHeaders() });
    assert.equal(markAll.status, 200);

    await prisma.notification.delete({ where: { id: notif.id } });
    void otherUser;
  });
});

describe("inventario · movimientos", () => {
  it("Almacén puede listar, Ventas no puede, y un query param inválido da 400", async () => {
    const ok = await fetch(`${baseUrl}/api/inventory/movements`, { headers: headersFor(almacenToken) });
    assert.equal(ok.status, 200);
    const okBody = (await ok.json()) as { items: unknown[] };
    assert.ok(Array.isArray(okBody.items));

    const forbidden = await fetch(`${baseUrl}/api/inventory/movements`, { headers: headersFor(ventasToken) });
    assert.equal(forbidden.status, 403);

    const badQuery = await fetch(`${baseUrl}/api/inventory/movements?productId=abc`, { headers: headersFor(almacenToken) });
    assert.equal(badQuery.status, 400);
  });
});

describe("dashboard", () => {
  it("GET /resumen trae carteraVencida numérico", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/resumen`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { carteraVencida: number };
    assert.equal(typeof body.carteraVencida, "number");
  });

  it("GET /indicadores funciona sin params y con rango, y rechaza rol incorrecto", async () => {
    const sinRango = await fetch(`${baseUrl}/api/dashboard/indicadores`, { headers: authHeaders() });
    assert.equal(sinRango.status, 200);

    const conRango = await fetch(`${baseUrl}/api/dashboard/indicadores?from=2026-01-01&to=2026-12-31`, { headers: authHeaders() });
    assert.equal(conRango.status, 200);

    const forbidden = await fetch(`${baseUrl}/api/dashboard/indicadores`, { headers: headersFor(almacenToken) });
    assert.equal(forbidden.status, 403);
  });
});

describe("exportaciones", () => {
  it("inventario es accesible para cualquier autenticado; pedidos requiere Ventas", async () => {
    const inv = await fetch(`${baseUrl}/api/export/inventario`, { headers: headersFor(almacenToken) });
    assert.equal(inv.status, 200);
    assert.ok(inv.headers.get("content-type")?.includes("spreadsheetml"));

    const forbidden = await fetch(`${baseUrl}/api/export/pedidos`, { headers: headersFor(almacenToken) });
    assert.equal(forbidden.status, 403);

    const allowed = await fetch(`${baseUrl}/api/export/pedidos`, { headers: headersFor(ventasToken) });
    assert.equal(allowed.status, 200);
  });
});

describe("facturas · vencimiento y PDF", () => {
  it("una factura con dueDate pasado y sin pagos queda 'vencida' en la cartera del cliente", async () => {
    const acme = await prisma.client.findFirst({ where: { name: "Cliente ACME" } });
    const bulto = await prisma.product.findFirst({ where: { sku: "BUL-001" } });
    assert.ok(acme && bulto, "requiere el seed (Cliente ACME, producto BUL-001)");

    const res = await fetch(`${baseUrl}/api/facturas`, {
      method: "POST",
      headers: headersFor(ventasToken),
      body: JSON.stringify({
        clientId: acme!.id,
        dueDate: "2020-01-01",
        items: [{ productId: bulto!.id, quantity: 1, unitPrice: 1000 }],
      }),
    });
    assert.equal(res.status, 201);
    const factura = (await res.json()) as { id: number; invoiceNumber: string };

    const cartera = (await (
      await fetch(`${baseUrl}/api/clients/${acme!.id}/cartera`, { headers: headersFor(ventasToken) })
    ).json()) as { facturasPendientes: { id: number; vencida: boolean }[] };
    const found = cartera.facturasPendientes.find((f) => f.id === factura.id);
    assert.ok(found, "la factura recién creada debe aparecer como pendiente");
    assert.equal(found!.vencida, true);

    const pdf = await fetch(`${baseUrl}/api/facturas/${factura.id}/pdf`, { headers: headersFor(ventasToken) });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    const buffer = Buffer.from(await pdf.arrayBuffer());
    assert.equal(buffer.subarray(0, 4).toString(), "%PDF");

    await prisma.facturaItem.deleteMany({ where: { facturaId: factura.id } });
    await prisma.factura.delete({ where: { id: factura.id } });
  });
});

describe("cotizaciones · PDF", () => {
  it("genera un PDF válido para una cotización", async () => {
    const acme = await prisma.client.findFirst({ where: { name: "Cliente ACME" } });
    const bulto = await prisma.product.findFirst({ where: { sku: "BUL-001" } });
    assert.ok(acme && bulto, "requiere el seed (Cliente ACME, producto BUL-001)");

    const created = (await (
      await fetch(`${baseUrl}/api/cotizaciones`, {
        method: "POST",
        headers: headersFor(ventasToken),
        body: JSON.stringify({ clientId: acme!.id, items: [{ productId: bulto!.id, quantity: 1, unitPrice: 1000 }] }),
      })
    ).json()) as { id: number };

    const pdf = await fetch(`${baseUrl}/api/cotizaciones/${created.id}/pdf`, { headers: headersFor(ventasToken) });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    const buffer = Buffer.from(await pdf.arrayBuffer());
    assert.equal(buffer.subarray(0, 4).toString(), "%PDF");

    await prisma.cotizacionItem.deleteMany({ where: { cotizacionId: created.id } });
    await prisma.cotizacion.delete({ where: { id: created.id } });
  });
});

describe("despachos · completar no rompe (hook de WhatsApp)", () => {
  it("marcar el último ítem pendiente completa el despacho sin error, aunque WhatsApp no esté configurado", async () => {
    const acme = await prisma.client.findFirst({ where: { name: "Cliente ACME" } });
    const bulto = await prisma.product.findFirst({ where: { sku: "BUL-001" } });
    assert.ok(acme && bulto);

    const created = (await (
      await fetch(`${baseUrl}/api/dispatches`, {
        method: "POST",
        headers: headersFor(almacenToken),
        body: JSON.stringify({ clientId: acme!.id, items: [{ productId: bulto!.id, quantityRequested: 1 }] }),
      })
    ).json()) as { id: number; items: { id: number }[] };

    const res = await fetch(`${baseUrl}/api/dispatches/${created.id}/items/${created.items[0].id}`, {
      method: "PATCH",
      headers: headersFor(almacenToken),
      body: JSON.stringify({ quantityDispatched: 1 }),
    });
    assert.equal(res.status, 200);

    const dispatch = await prisma.dispatch.findUnique({ where: { id: created.id } });
    assert.equal(dispatch!.status, "despachado");

    await prisma.dispatchItem.deleteMany({ where: { dispatchId: created.id } });
    await prisma.inventoryMovement.deleteMany({ where: { referenceType: "dispatch_item", referenceId: created.items[0].id } });
    await prisma.dispatch.delete({ where: { id: created.id } });
  });
});

describe("almacén · ubicación por token", () => {
  it("resuelve el token del QR a la ubicación correcta, 404 con token inválido, 403 con rol incorrecto", async () => {
    const code = `TEST-LOC-${Date.now()}`;
    const location = (await (
      await fetch(`${baseUrl}/api/warehouse/locations`, {
        method: "POST",
        headers: headersFor(almacenToken),
        body: JSON.stringify({ code, label: "Ubicación de test" }),
      })
    ).json()) as { id: number; code: string };

    const qr = (await (
      await fetch(`${baseUrl}/api/warehouse/locations/${location.id}/qr`, { headers: headersFor(almacenToken) })
    ).json()) as { url: string };
    const locToken = qr.url.split("/").pop()!;

    const resolved = await fetch(`${baseUrl}/api/warehouse/locations/by-token/${locToken}`, { headers: headersFor(almacenToken) });
    assert.equal(resolved.status, 200);
    const resolvedBody = (await resolved.json()) as { id: number; code: string };
    assert.equal(resolvedBody.id, location.id);
    assert.equal(resolvedBody.code, code);

    const notFound = await fetch(`${baseUrl}/api/warehouse/locations/by-token/token-invalido`, { headers: headersFor(almacenToken) });
    assert.equal(notFound.status, 404);

    const forbidden = await fetch(`${baseUrl}/api/warehouse/locations/by-token/${locToken}`, { headers: headersFor(ventasToken) });
    assert.equal(forbidden.status, 403);

    await prisma.warehouseLocation.delete({ where: { id: location.id } });
  });
});

describe("frecuentes · ranking, boost por interacciones y purga semanal", () => {
  it("redistribuye en ranking: el mas visitado conserva el valor mas alto", () => {
    const next = redistributeScores([
      { id: 1, score: 50 },
      { id: 2, score: 37 },
      { id: 3, score: 12 },
      { id: 4, score: 2 },
    ]);
    assert.deepEqual(
      next.sort((a, b) => a.id - b.id).map((c) => c.score),
      [3, 2, 1, 0]
    );
  });

  it("desempata por visitas más recientes", () => {
    const next = redistributeScores([
      { id: 1, score: 10, lastActiveAt: "2026-08-01T00:00:00Z" },
      { id: 2, score: 10, lastActiveAt: "2026-08-07T00:00:00Z" },
    ]);
    const byId: Record<number, number> = Object.fromEntries(next.map((c) => [c.id, c.score]));
    assert.equal(byId[2], 1, "el visto más recientemente gana el tie");
    assert.equal(byId[1], 0);
  });

  it("con un solo cliente queda en 0", () => {
    const next = redistributeScores([{ id: 1, score: 999 }]);
    assert.deepEqual(next, [{ id: 1, score: 0 }]);
  });

  it("boostValue iguala el maximo y suma uno", () => {
    assert.equal(boostValue(10), 11);
    assert.equal(boostValue(null), 1);
    assert.equal(boostValue(0), 1);
  });

  it("isHot/nextCycle se basan en interacciones del ciclo", () => {
    assert.equal(isHot(4, HOT_THRESHOLD), false);
    assert.equal(isHot(5, HOT_THRESHOLD), true);
    assert.equal(nextCycle(null), 1);
    assert.equal(nextCycle(4), 5);
  });

  it("nextVisitState: +1 normal o boost consumido al cruzar el umbral (motor común)", () => {
    assert.deepEqual(nextVisitState({ viewCount: 3, cycleInteractions: 4 }, 10), { viewCount: 11, cycleInteractions: 0 });
    assert.deepEqual(nextVisitState({ viewCount: 3, cycleInteractions: 2 }, 10), { viewCount: 4, cycleInteractions: 3 });
  });
});
