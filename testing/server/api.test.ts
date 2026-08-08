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
import { redistributeScores, boostValue, isHot, nextCycle, nextVisitState, HOT_THRESHOLD } from "../../server/src/services/frequency";

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
