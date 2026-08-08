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
import { prisma } from "../../server/src/prisma";
import { computeRedistribution, nextStreak, liveBoostValue } from "../../server/src/services/frecuentesReset";

let server: Server;
let baseUrl = "";
let token = "";

const authHeaders = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

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
    // Forzar una racha que está a un día del umbral (4 < 5) con la última
    // visita ayer: la siguiente visita debe cruzar el umbral y subir el
    // viewCount al máximo actual + 1 (no solo +1).
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.client.update({ where: { id: clientId }, data: { visitStreak: 4, lastViewedAt: ayer, viewCount: 0 } });
    const antes = await prisma.client.aggregate({ _max: { viewCount: true } });

    const res = await fetch(`${baseUrl}/api/clients/${clientId}/visit`, { method: "POST", headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { viewCount: number; visitStreak: number };
    assert.equal(body.visitStreak, 5, "la visita de hoy cierra la racha en el umbral");
    assert.equal(body.viewCount, (antes._max.viewCount ?? 0) + 1, "el boost sube al máximo + 1");
  });

  it("GET /contacts devuelve contactos con empresa relacionada", async () => {
    const res = await fetch(`${baseUrl}/api/clients/contacts`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const contacts = (await res.json()) as { name: string; client: { id: number; name: string } | null }[];
    assert.ok(Array.isArray(contacts));
    assert.ok(contacts.length > 0, "El seed incluye contactos");
    assert.ok(contacts.every((c) => c.client && typeof c.client.name === "string"));
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

describe("frecuentes · redistribución semanal por ranking", () => {
  it("asigna el valor más alto al más visitado y 0 al menos visitado", () => {
    const next = computeRedistribution([
      { id: 1, viewCount: 50 },
      { id: 2, viewCount: 37 },
      { id: 3, viewCount: 12 },
      { id: 4, viewCount: 2 },
    ]);
    assert.deepEqual(
      next.sort((a, b) => a.id - b.id).map((c) => c.viewCount),
      [3, 2, 1, 0]
    );
  });

  it("desempata por visitas más recientes", () => {
    const next = computeRedistribution([
      { id: 1, viewCount: 10, lastViewedAt: "2026-08-01T00:00:00Z" },
      { id: 2, viewCount: 10, lastViewedAt: "2026-08-07T00:00:00Z" },
    ]);
    const byId: Record<number, number> = Object.fromEntries(next.map((c) => [c.id, c.viewCount]));
    assert.equal(byId[2], 1, "el visto más recientemente gana el tie");
    assert.equal(byId[1], 0);
  });

  it("con un solo cliente queda en 0", () => {
    const next = computeRedistribution([{ id: 1, viewCount: 999 }]);
    assert.deepEqual(next, [{ id: 1, viewCount: 0 }]);
  });

  it("un cliente con racha supera al mas visitado aunque tenga poco conteo", () => {
    const next = computeRedistribution([
      { id: 1, viewCount: 50, streak: 0 },
      { id: 2, viewCount: 2, streak: 5 },
    ]);
    const byId: Record<number, number> = Object.fromEntries(next.map((c) => [c.id, c.viewCount]));
    assert.equal(byId[2], 1, "el de racha sube arriba del ranking");
    assert.equal(byId[1], 0);
  });

  it("varios de racha se ordenan por la racha mas larga primero", () => {
    const next = computeRedistribution([
      { id: 1, viewCount: 50, streak: 0 },
      { id: 2, viewCount: 9, streak: 5 },
      { id: 3, viewCount: 5, streak: 7 },
      { id: 4, viewCount: 0, streak: 6 },
    ]);
    const byId: Record<number, number> = Object.fromEntries(next.map((c) => [c.id, c.viewCount]));
    assert.equal(byId[3], 3, "racha 7 -> el primero");
    assert.equal(byId[4], 2, "racha 6 -> segundo");
    assert.equal(byId[2], 1, "racha 5 -> tercero");
    assert.equal(byId[1], 0, "sin racha, aunque tenga 50 visitas -> ultimo");
  });

  it("por debajo del umbral NO hay boost", () => {
    const next = computeRedistribution([{ id: 1, viewCount: 50, streak: 4 }, { id: 2, viewCount: 30, streak: 0 }]);
    const byId: Record<number, number> = Object.fromEntries(next.map((c) => [c.id, c.viewCount]));
    assert.equal(byId[1], 1, "racha 4 < umbral 5 -> orden normal por conteo");
    assert.equal(byId[2], 0);
  });

  it("liveBoostValue iguala el maximo y suma uno", () => {
    assert.equal(liveBoostValue(10), 11);
    assert.equal(liveBoostValue(null), 1);
    assert.equal(liveBoostValue(0), 1);
  });

  it("nextStreak: crece al dia siguiente, se mantiene el mismo dia y reinicia tras un hueco", () => {
    const hoy = new Date(2026, 7, 8, 10, 0, 0); // 8-ago-2026
    const ayer = new Date(2026, 7, 7, 9, 0, 0);
    const hoyTemprano = new Date(2026, 7, 8, 8, 0, 0);
    const hace3Dias = new Date(2026, 7, 5, 15, 0, 0);

    assert.equal(nextStreak(2, ayer, hoy), 3, "visita de ayer incrementa la racha");
    assert.equal(nextStreak(3, hoyTemprano, hoy), 3, "segunda visita del mismo dia mantiene la racha");
    assert.equal(nextStreak(5, hace3Dias, hoy), 1, "hueco de dias reinicia la racha");
    assert.equal(nextStreak(0, null, hoy), 1, "primera visita arranca en 1");
  });
});
