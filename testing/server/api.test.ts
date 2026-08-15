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
import { productionOrdersRouter } from "../../server/src/routes/productionOrders";
import { dispatchesRouter } from "../../server/src/routes/dispatches";
import { cotizacionesRouter } from "../../server/src/routes/cotizaciones";
import { pedidosRouter } from "../../server/src/routes/pedidos";
import { facturasRouter } from "../../server/src/routes/facturas";
import { auditLogRouter } from "../../server/src/routes/auditLog";
import { productsRouter } from "../../server/src/routes/products";
import { usersRouter } from "../../server/src/routes/users";
import { warehouseRouter } from "../../server/src/routes/warehouse";
import { publicLocationRouter } from "../../server/src/routes/publicLocation";
import { dashboardRouter } from "../../server/src/routes/dashboard";
import { exportRouter } from "../../server/src/routes/export";
import { notificationsRouter } from "../../server/src/routes/notifications";
import { whatsappWebhookRouter } from "../../server/src/routes/whatsappWebhook";
import { prisma } from "../../server/src/prisma";
import { redistributeScores, boostValue, isHot, nextCycle, nextVisitState, HOT_THRESHOLD } from "../../server/src/services/frequency";

let server: Server;
let baseUrl = "";
let token = "";

// Un token por rol de la matriz, para probar tanto el "camino feliz" como
// los 403 de `requireRole` sin depender siempre de super_admin (que pasa
// todos los checks y por lo tanto no prueba nada sobre el guard en sí).
const tokens: Record<string, string> = {};

const authHeaders = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
const headersFor = (role: string) => ({ Authorization: `Bearer ${tokens[role]}`, "Content-Type": "application/json" });

async function loginAs(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  if (res.status !== 200) {
    throw new Error(`login falló para ${email} (status ${res.status}): ${await res.text()}`);
  }
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
  app.use("/api/production-orders", productionOrdersRouter);
  app.use("/api/dispatches", dispatchesRouter);
  app.use("/api/cotizaciones", cotizacionesRouter);
  app.use("/api/pedidos", pedidosRouter);
  app.use("/api/facturas", facturasRouter);
  app.use("/api/audit-log", auditLogRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/warehouse", warehouseRouter);
  app.use("/api/public/locations", publicLocationRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/webhook/whatsapp", whatsappWebhookRouter);
  return app;
}

before(async () => {
  const app = buildApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  token = await loginAs("admin@empresa.com");
  tokens.super_admin = token;
  tokens.ventas = await loginAs("ventas@empresa.com");
  tokens.almacen = await loginAs("despacho@empresa.com");
  tokens.produccion = await loginAs("produccion@empresa.com");
  tokens.planeacion = await loginAs("planeacion@empresa.com");
  tokens.calidad = await loginAs("calidad@empresa.com");
  tokens.auditor = await loginAs("auditor@empresa.com");
  tokens.operario_extrusion = await loginAs("operario.extrusion@empresa.com");
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

  it("usuario desactivado no puede loguearse", async () => {
    const user = await prisma.user.create({
      data: { name: "TEST-Inactive", email: `test-inactive-${Date.now()}@x.com`, passwordHash: "x", role: "calidad", active: false },
    });
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user.email, password: "password123" }),
    });
    assert.equal(res.status, 401);
    await prisma.user.delete({ where: { id: user.id } });
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

  it("GET /movements exige rol de almacén y devuelve paginado", async () => {
    const denied = await fetch(`${baseUrl}/api/inventory/movements`, { headers: headersFor("ventas") });
    assert.equal(denied.status, 403);

    const res = await fetch(`${baseUrl}/api/inventory/movements?pageSize=5`, { headers: headersFor("almacen") });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[]; total: number; page: number; pageSize: number };
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length <= 5);
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 5);
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

  it("devuelve 403 para un rol sin acceso a Despachos", async () => {
    const res = await fetch(`${baseUrl}/api/dispatches`, { headers: headersFor("ventas") });
    assert.equal(res.status, 403);
  });
});

describe("producción · alta manual e importación", () => {
  it("alta manual: crea la entrada, suma stock y crea el cliente si no existe", async () => {
    const clientName = `TEST-PROD-CLIENTE-${Date.now()}`;
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId: product.id } });

    const res = await fetch(`${baseUrl}/api/production/entries`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ sku: "BUL-001", operatorName: "Test Operario", kilos: 3, clientName }),
    });
    assert.equal(res.status, 201);
    const entry = (await res.json()) as { id: number; status: string };
    assert.equal(entry.status, "recibido");

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId: product.id } });
    assert.equal(Number(stockDespues!.currentQuantity), Number(stockAntes?.currentQuantity ?? 0) + 3);

    const client = await prisma.client.findFirst({ where: { name: clientName } });
    assert.ok(client, "el cliente debió crearse automáticamente");

    await prisma.inventoryMovement.deleteMany({ where: { productionEntryId: entry.id } });
    await prisma.productionEntry.delete({ where: { id: entry.id } });
    await prisma.inventoryStock.update({ where: { productId: product.id }, data: { currentQuantity: stockAntes?.currentQuantity ?? 0 } });
    await prisma.client.delete({ where: { id: client!.id } });
  });

  it("alta manual con SKU inexistente devuelve 400", async () => {
    const res = await fetch(`${baseUrl}/api/production/entries`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ sku: "NO-EXISTE-SKU", operatorName: "Test", kilos: 1 }),
    });
    assert.equal(res.status, 400);
  });

  it("import preview parsea el CSV sin persistir nada", async () => {
    const csv = "SKU,Etiqueta,Operario,Cliente,Medida,Kilos,Conductor,Observaciones\nBUL-001,ETQ-1,Juan,,25kg,10,,\n,,Pedro,,,,,\n";
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "reporte.csv");

    const res = await fetch(`${baseUrl}/api/production/import/preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tokens.almacen}` },
      body: form,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { totalRows: number; validRows: number; invalidRows: number; rows: any[] };
    assert.equal(body.totalRows, 2);
    assert.equal(body.validRows, 1);
    assert.equal(body.invalidRows, 1);
    assert.equal(body.rows[1].error, "Falta SKU");
  });

  it("import confirm persiste solo las filas válidas y registra import_logs", async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId: product.id } });

    const res = await fetch(`${baseUrl}/api/production/import/confirm`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({
        filename: "reporte.csv",
        rows: [
          { sku: "BUL-001", operatorName: "Juan", kilos: 7 },
          { sku: "", operatorName: "", kilos: 0, error: "Falta SKU" },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { processed: number; failed: number };
    assert.equal(body.processed, 1);
    assert.equal(body.failed, 1);

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId: product.id } });
    assert.equal(Number(stockDespues!.currentQuantity), Number(stockAntes?.currentQuantity ?? 0) + 7);

    const log = await prisma.importLog.findFirst({ where: { filename: "reporte.csv" }, orderBy: { createdAt: "desc" } });
    assert.ok(log);
    assert.equal(log!.rowsProcessed, 1);
    assert.equal(log!.rowsFailed, 1);

    const entry = await prisma.productionEntry.findFirst({ where: { operatorName: "Juan", kilos: 7 as any }, orderBy: { createdAt: "desc" } });
    assert.ok(entry);
    await prisma.inventoryMovement.deleteMany({ where: { productionEntryId: entry!.id } });
    await prisma.productionEntry.delete({ where: { id: entry!.id } });
    await prisma.inventoryStock.update({ where: { productId: product.id }, data: { currentQuantity: stockAntes?.currentQuantity ?? 0 } });
    await prisma.importLog.delete({ where: { id: log!.id } });
  });
});

describe("órdenes de producción · ciclo completo (estaciones, calidad, planeación)", () => {
  let productId = 0;

  before(async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });
    productId = product.id;
  });

  it("devuelve 403 para un rol sin acceso al módulo (ventas)", async () => {
    const res = await fetch(`${baseUrl}/api/production-orders`, { headers: headersFor("ventas") });
    assert.equal(res.status, 403);
  });

  it("crea una OP con numeración OP-XXXXX", async () => {
    const res = await fetch(`${baseUrl}/api/production-orders`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ productId, quantityPlanned: 50 }),
    });
    assert.equal(res.status, 201);
    const order = (await res.json()) as { id: number; orderNumber: string; status: string };
    assert.match(order.orderNumber, /^OP-\d{5}$/);
    assert.equal(order.status, "pendiente");
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("un operario no puede registrar la etapa de otra estación", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10 },
    });
    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/stages`, {
      method: "POST",
      headers: headersFor("operario_extrusion"),
      body: JSON.stringify({
        station: "impresion",
        machine: "IMP-1",
        operatorName: "Op",
        startTime: new Date().toISOString(),
        kilosProduced: 5,
      }),
    });
    assert.equal(res.status, 403);
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("registrar la etapa de precorte deja la OP pendiente_calidad y notifica a Calidad (sin mover stock)", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10 },
    });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId } });

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/stages`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({
        station: "precorte",
        machine: "PRE-1",
        operatorName: "Op",
        startTime: new Date().toISOString(),
        kilosProduced: 12,
      }),
    });
    assert.equal(res.status, 201);

    const updated = await prisma.productionOrder.findUnique({ where: { id: order.id } });
    assert.equal(updated!.status, "pendiente_calidad");

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId } });
    assert.equal(Number(stockDespues?.currentQuantity ?? 0), Number(stockAntes?.currentQuantity ?? 0), "el precorte no mueve stock todavía");

    const notif = await prisma.notification.findFirst({
      where: { type: "op_pendiente_calidad", message: { contains: order.orderNumber } },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(notif, "Calidad debió recibir una notificación");
    assert.equal(notif!.link, "/calidad");

    await prisma.notification.delete({ where: { id: notif!.id } });
    await prisma.productionStageLog.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("Calidad aprueba: genera la entrada de inventario con el kilaje del precorte y finaliza la OP", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10, status: "pendiente_calidad" },
    });
    await prisma.productionStageLog.create({
      data: { productionOrderId: order.id, station: "precorte", machine: "PRE-1", operatorName: "Op", startTime: new Date(), kilosProduced: 8 },
    });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId } });

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/quality-check`, {
      method: "POST",
      headers: headersFor("calidad"),
      body: JSON.stringify({ result: "aprobado" }),
    });
    assert.equal(res.status, 201);

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId } });
    assert.equal(Number(stockDespues!.currentQuantity), Number(stockAntes?.currentQuantity ?? 0) + 8);

    const updated = await prisma.productionOrder.findUnique({ where: { id: order.id } });
    assert.equal(updated!.status, "finalizada");

    // Un segundo control de calidad sobre la misma OP debe rechazarse.
    const dup = await fetch(`${baseUrl}/api/production-orders/${order.id}/quality-check`, {
      method: "POST",
      headers: headersFor("calidad"),
      body: JSON.stringify({ result: "aprobado" }),
    });
    assert.equal(dup.status, 400);

    await prisma.qualityCheck.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.inventoryMovement.deleteMany({ where: { referenceType: "manual_adjustment", productId, createdAt: { gte: order.createdAt } } });
    await prisma.productionStageLog.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.productionOrder.delete({ where: { id: order.id } });
    await prisma.inventoryStock.update({ where: { productId }, data: { currentQuantity: stockAntes?.currentQuantity ?? 0 } });
  });

  it("Calidad rechaza: deja la OP detenida sin mover stock y notifica a Producción/Gestión", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10, status: "pendiente_calidad" },
    });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId } });

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/quality-check`, {
      method: "POST",
      headers: headersFor("calidad"),
      body: JSON.stringify({ result: "rechazado", observations: "Merma excesiva" }),
    });
    assert.equal(res.status, 201);

    const updated = await prisma.productionOrder.findUnique({ where: { id: order.id } });
    assert.equal(updated!.status, "detenida");

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId } });
    assert.equal(Number(stockDespues?.currentQuantity ?? 0), Number(stockAntes?.currentQuantity ?? 0));

    const notif = await prisma.notification.findFirst({
      where: { type: "op_rechazada", message: { contains: order.orderNumber } },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(notif, "Producción/Gestión debió recibir una notificación de rechazo");

    await prisma.notification.delete({ where: { id: notif!.id } });
    await prisma.qualityCheck.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("cola de Planeación: genera la OP de un ítem pendiente y ya no lo vuelve a listar", async () => {
    const pending = await fetch(`${baseUrl}/api/production-orders/pending-planning`, { headers: headersFor("planeacion") });
    assert.equal(pending.status, 200);
    const items = (await pending.json()) as { pedidoVersionItemId: number; productSku: string }[];
    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0, "El seed (PED-SEED-PLANEACION) debe dejar al menos un ítem pendiente");
    const target = items[0];

    const generate = await fetch(`${baseUrl}/api/production-orders/from-pedido-item/${target.pedidoVersionItemId}`, {
      method: "POST",
      headers: headersFor("planeacion"),
    });
    assert.equal(generate.status, 201);
    const order = (await generate.json()) as { id: number; pedidoVersionItemId: number };
    assert.equal(order.pedidoVersionItemId, target.pedidoVersionItemId);

    const dup = await fetch(`${baseUrl}/api/production-orders/from-pedido-item/${target.pedidoVersionItemId}`, {
      method: "POST",
      headers: headersFor("planeacion"),
    });
    assert.equal(dup.status, 400);

    const after2 = await fetch(`${baseUrl}/api/production-orders/pending-planning`, { headers: headersFor("planeacion") });
    const itemsAfter = (await after2.json()) as { pedidoVersionItemId: number }[];
    assert.ok(!itemsAfter.some((i) => i.pedidoVersionItemId === target.pedidoVersionItemId), "el ítem generado ya no debe listarse");

    // Se libera el ítem para que el seed siga siendo reutilizable en próximas corridas.
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("PATCH /:id/status valida el enum y cambia el estado", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10 },
    });

    const bad = await fetch(`${baseUrl}/api/production-orders/${order.id}/status`, {
      method: "PATCH",
      headers: headersFor("produccion"),
      body: JSON.stringify({ status: "no-existe" }),
    });
    assert.equal(bad.status, 400);

    const ok = await fetch(`${baseUrl}/api/production-orders/${order.id}/status`, {
      method: "PATCH",
      headers: headersFor("produccion"),
      body: JSON.stringify({ status: "cancelada" }),
    });
    assert.equal(ok.status, 200);
    const updated = (await ok.json()) as { status: string };
    assert.equal(updated.status, "cancelada");

    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("GET /:id (Trazabilidad) devuelve el detalle completo y 404 si no existe", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10 },
    });
    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}`, { headers: headersFor("auditor") });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: number; product: { sku: string }; stages: unknown[] };
    assert.equal(body.id, order.id);
    assert.equal(body.product.sku, "BUL-001");
    assert.ok(Array.isArray(body.stages));

    const notFound = await fetch(`${baseUrl}/api/production-orders/999999999`, { headers: headersFor("auditor") });
    assert.equal(notFound.status, 404);

    await prisma.productionOrder.delete({ where: { id: order.id } });
  });
});

describe("cotizaciones → pedido → factura → pagos", () => {
  let clientId = 0;
  let productId = 0;
  let unitPrice = 0;

  before(async () => {
    const client = await prisma.client.create({ data: { name: `TEST-COT-CLIENT-${Date.now()}` } });
    clientId = client.id;
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });
    productId = product.id;
    unitPrice = Number(product.unitPrice);
  });

  after(async () => {
    await prisma.client.delete({ where: { id: clientId } }).catch(() => {});
  });

  it("devuelve 403 para un rol sin acceso a Cotizaciones", async () => {
    const res = await fetch(`${baseUrl}/api/cotizaciones`, { headers: headersFor("almacen") });
    assert.equal(res.status, 403);
  });

  it("crea una cotización, hereda el precio de catálogo, la convierte a pedido, factura y cobra", async () => {
    // 1. Cotización: el ítem no trae unitPrice → hereda el del catálogo.
    const cotRes = await fetch(`${baseUrl}/api/cotizaciones`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ clientId, items: [{ productId, quantity: 4 }] }),
    });
    assert.equal(cotRes.status, 201);
    const cotizacion = (await cotRes.json()) as { id: number; quoteNumber: string; items: { unitPrice: string }[] };
    assert.match(cotizacion.quoteNumber, /^COT-\d{5}$/);
    assert.equal(Number(cotizacion.items[0].unitPrice), unitPrice);

    // 2. Cambiar estado.
    const statusRes = await fetch(`${baseUrl}/api/cotizaciones/${cotizacion.id}/status`, {
      method: "PATCH",
      headers: headersFor("ventas"),
      body: JSON.stringify({ status: "aceptada" }),
    });
    assert.equal(statusRes.status, 200);

    // 3. Convertir a pedido (v1, sin borrar la cotización).
    const pedRes = await fetch(`${baseUrl}/api/cotizaciones/${cotizacion.id}/convertir-a-pedido`, {
      method: "POST",
      headers: headersFor("ventas"),
    });
    assert.equal(pedRes.status, 201);
    const pedido = (await pedRes.json()) as { id: number; orderNumber: string; versions: { items: { quantity: string }[] }[] };
    assert.match(pedido.orderNumber, /^PED-\d{5}$/);
    assert.equal(pedido.versions[0].items.length, 1);
    assert.equal(Number(pedido.versions[0].items[0].quantity), 4);

    const cotDespues = await prisma.cotizacion.findUnique({ where: { id: cotizacion.id } });
    assert.ok(cotDespues, "la cotización no se borra al convertir");

    // 4. Editar el pedido crea una v2 (no sobrescribe).
    const editRes = await fetch(`${baseUrl}/api/pedidos/${pedido.id}`, {
      method: "PATCH",
      headers: headersFor("ventas"),
      body: JSON.stringify({ status: "aprobado", items: [{ productId, quantity: 6 }] }),
    });
    assert.equal(editRes.status, 201, "PATCH /pedidos/:id crea una versión nueva → 201");
    const versions = await fetch(`${baseUrl}/api/pedidos/${pedido.id}/versions`, { headers: headersFor("ventas") });
    const versionsBody = (await versions.json()) as { versionNumber: number }[];
    assert.equal(versionsBody.length, 2);

    // 5. Factura desde el pedido: copia la ÚLTIMA versión (v2, cantidad 6).
    const facRes = await fetch(`${baseUrl}/api/facturas/desde-pedido/${pedido.id}`, {
      method: "POST",
      headers: headersFor("ventas"),
    });
    assert.equal(facRes.status, 201);
    const factura = (await facRes.json()) as { id: number; invoiceNumber: string; status: string; items: { quantity: string }[] };
    assert.match(factura.invoiceNumber, /^FAC-\d{5}$/);
    assert.equal(factura.status, "emitida");
    assert.equal(Number(factura.items[0].quantity), 6);

    const total = 6 * unitPrice;

    // 6. Abono parcial → pagada_parcial.
    const pagoParcial = await fetch(`${baseUrl}/api/facturas/${factura.id}/payments`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ amount: total / 2, method: "transferencia" }),
    });
    assert.equal(pagoParcial.status, 201);
    let facturaActual = await prisma.factura.findUnique({ where: { id: factura.id } });
    assert.equal(facturaActual!.status, "pagada_parcial");

    // 7. Abono restante → pagada.
    const pagoFinal = await fetch(`${baseUrl}/api/facturas/${factura.id}/payments`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ amount: total / 2, method: "efectivo" }),
    });
    assert.equal(pagoFinal.status, 201);
    facturaActual = await prisma.factura.findUnique({ where: { id: factura.id } });
    assert.equal(facturaActual!.status, "pagada");

    // 8. Anular: acción manual; después no admite más pagos.
    const anular = await fetch(`${baseUrl}/api/facturas/${factura.id}/anular`, {
      method: "PATCH",
      headers: headersFor("ventas"),
    });
    assert.equal(anular.status, 200);
    const pagoTrasAnular = await fetch(`${baseUrl}/api/facturas/${factura.id}/payments`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ amount: 1, method: "efectivo" }),
    });
    assert.equal(pagoTrasAnular.status, 400);

    // Cleanup completo del árbol creado.
    await prisma.payment.deleteMany({ where: { facturaId: factura.id } });
    await prisma.facturaItem.deleteMany({ where: { facturaId: factura.id } });
    await prisma.factura.delete({ where: { id: factura.id } });
    const allVersions = await prisma.pedidoVersion.findMany({ where: { pedidoId: pedido.id } });
    for (const v of allVersions) {
      await prisma.pedidoVersionItem.deleteMany({ where: { pedidoVersionId: v.id } });
    }
    await prisma.pedidoVersion.deleteMany({ where: { pedidoId: pedido.id } });
    await prisma.pedido.delete({ where: { id: pedido.id } });
    await prisma.cotizacionItem.deleteMany({ where: { cotizacionId: cotizacion.id } });
    await prisma.cotizacion.delete({ where: { id: cotizacion.id } });
  });

  it("crear cotización sin ítems devuelve 400 (zod min 1)", async () => {
    const res = await fetch(`${baseUrl}/api/cotizaciones`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ clientId, items: [] }),
    });
    assert.equal(res.status, 400);
  });

  it("crear factura con producto inexistente devuelve 400", async () => {
    const res = await fetch(`${baseUrl}/api/facturas`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ clientId, items: [{ productId: 999999999, quantity: 1 }] }),
    });
    assert.equal(res.status, 400);
  });

  it("GET /:id/pdf genera un PDF descargable para cotización y factura", async () => {
    const cotRes = await fetch(`${baseUrl}/api/cotizaciones`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ clientId, items: [{ productId, quantity: 2 }] }),
    });
    const cotizacion = (await cotRes.json()) as { id: number; quoteNumber: string };

    const cotPdf = await fetch(`${baseUrl}/api/cotizaciones/${cotizacion.id}/pdf`, { headers: headersFor("ventas") });
    assert.equal(cotPdf.status, 200);
    assert.match(cotPdf.headers.get("content-type") ?? "", /application\/pdf/);
    assert.match(cotPdf.headers.get("content-disposition") ?? "", new RegExp(`${cotizacion.quoteNumber}\\.pdf`));
    const cotBuf = await cotPdf.arrayBuffer();
    assert.ok(cotBuf.byteLength > 0);
    // Firma binaria estándar de un PDF: "%PDF-".
    assert.equal(Buffer.from(cotBuf.slice(0, 5)).toString("ascii"), "%PDF-");

    const facRes = await fetch(`${baseUrl}/api/facturas`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ clientId, items: [{ productId, quantity: 1 }], dueDate: "2020-01-01" }),
    });
    const factura = (await facRes.json()) as { id: number; invoiceNumber: string };

    const facPdf = await fetch(`${baseUrl}/api/facturas/${factura.id}/pdf`, { headers: headersFor("ventas") });
    assert.equal(facPdf.status, 200);
    assert.match(facPdf.headers.get("content-type") ?? "", /application\/pdf/);
    const facBuf = await facPdf.arrayBuffer();
    assert.ok(facBuf.byteLength > 0);

    const pdfNotFound = await fetch(`${baseUrl}/api/facturas/999999999/pdf`, { headers: headersFor("ventas") });
    assert.equal(pdfNotFound.status, 404);

    await prisma.facturaItem.deleteMany({ where: { facturaId: factura.id } });
    await prisma.factura.delete({ where: { id: factura.id } });
    await prisma.cotizacionItem.deleteMany({ where: { cotizacionId: cotizacion.id } });
    await prisma.cotizacion.delete({ where: { id: cotizacion.id } });
  });

  it("factura con dueDate vencido: la cartera del cliente la marca 'vencida' y aporta a carteraVencida del dashboard", async () => {
    const carteraAntes = await fetch(`${baseUrl}/api/dashboard/resumen`, { headers: authHeaders() });
    const { carteraVencida: vencidaAntes } = (await carteraAntes.json()) as { carteraVencida: number };

    const facRes = await fetch(`${baseUrl}/api/facturas`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ clientId, items: [{ productId, quantity: 3 }], dueDate: "2020-01-01" }),
    });
    assert.equal(facRes.status, 201);
    const factura = (await facRes.json()) as { id: number };

    const cartera = await fetch(`${baseUrl}/api/clients/${clientId}/cartera`, { headers: headersFor("ventas") });
    assert.equal(cartera.status, 200);
    const carteraBody = (await cartera.json()) as {
      facturasPendientes: { id: number; vencida: boolean; dueDate: string | null }[];
    };
    const facturaEnCartera = carteraBody.facturasPendientes.find((f) => f.id === factura.id);
    assert.ok(facturaEnCartera, "la factura recién creada debe listarse en la cartera");
    assert.equal(facturaEnCartera!.vencida, true);
    assert.ok(facturaEnCartera!.dueDate);

    const total = unitPrice * 3;
    const carteraDespues = await fetch(`${baseUrl}/api/dashboard/resumen`, { headers: authHeaders() });
    const { carteraVencida: vencidaDespues } = (await carteraDespues.json()) as { carteraVencida: number };
    assert.equal(vencidaDespues, vencidaAntes + total, "la factura vencida debe sumar su saldo completo a carteraVencida");

    // Una vez pagada, deja de estar vencida (saldo = 0) aunque la fecha ya pasó.
    await fetch(`${baseUrl}/api/facturas/${factura.id}/payments`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ amount: total, method: "efectivo" }),
    });
    const carteraFinal = await fetch(`${baseUrl}/api/clients/${clientId}/cartera`, { headers: headersFor("ventas") });
    const carteraFinalBody = (await carteraFinal.json()) as { facturasPendientes: { id: number }[] };
    assert.ok(!carteraFinalBody.facturasPendientes.some((f) => f.id === factura.id), "pagada, ya no tiene saldo pendiente");

    await prisma.payment.deleteMany({ where: { facturaId: factura.id } });
    await prisma.facturaItem.deleteMany({ where: { facturaId: factura.id } });
    await prisma.factura.delete({ where: { id: factura.id } });
  });
});

describe("dashboard · indicadores con rango de fechas", () => {
  it("con from/to filtra por ese rango exacto (sin depender de cuántos checks reales haya hoy)", async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });
    const matchingRange = "from=2025-12-25&to=2026-01-05";
    const nonMatchingRange = "from=2025-06-01&to=2025-06-02";

    const getAprobadas = async (query: string) => {
      const res = await fetch(`${baseUrl}/api/dashboard/indicadores?${query}`, { headers: authHeaders() });
      assert.equal(res.status, 200);
      const body = (await res.json()) as { calidad: { aprobadas: number } };
      return body.calidad.aprobadas;
    };

    const dentroAntes = await getAprobadas(matchingRange);
    const fueraAntes = await getAprobadas(nonMatchingRange);

    const viejo = await prisma.qualityCheck.create({
      data: {
        productionOrder: {
          create: { orderNumber: `OP-TEST-OLD-${Date.now()}`, productId: product.id, quantityPlanned: 1, status: "finalizada" },
        },
        result: "aprobado",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const dentroDespues = await getAprobadas(matchingRange);
    const fueraDespues = await getAprobadas(nonMatchingRange);

    assert.equal(dentroDespues, dentroAntes + 1, "el check de enero 2026 debe contarse cuando el rango lo incluye");
    assert.equal(fueraDespues, fueraAntes, "un rango que no lo incluye no debe verse afectado");

    await prisma.qualityCheck.delete({ where: { id: viejo.id } });
    await prisma.productionOrder.delete({ where: { id: viejo.productionOrderId } });
  });
});

describe("despachos · notificación por WhatsApp al completarse", () => {
  it("sin credenciales de WhatsApp configuradas, queda en modo no-op (no rompe el flujo) y no duplica el aviso", async () => {
    const client = await prisma.client.create({ data: { name: `TEST-WA-CLIENT-${Date.now()}` } });
    await prisma.clientContact.create({ data: { clientId: client.id, name: "Contacto", phone: "3001234567", isPrimary: true } });
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });

    const dispatchRes = await fetch(`${baseUrl}/api/dispatches`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ clientId: client.id, items: [{ productId: product.id, quantityRequested: 2 }] }),
    });
    const dispatch = (await dispatchRes.json()) as { id: number; items: { id: number }[] };

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((...args: unknown[]) => {
      logs.push(args.join(" "));
    }) as typeof console.log;

    try {
      const complete = await fetch(`${baseUrl}/api/dispatches/${dispatch.id}/items/${dispatch.items[0].id}`, {
        method: "PATCH",
        headers: headersFor("almacen"),
        body: JSON.stringify({ quantityDispatched: 2 }),
      });
      assert.equal(complete.status, 200);

      // Reintento sobre el mismo item ya completado: no debe reenviar el aviso.
      const retry = await fetch(`${baseUrl}/api/dispatches/${dispatch.id}/items/${dispatch.items[0].id}`, {
        method: "PATCH",
        headers: headersFor("almacen"),
        body: JSON.stringify({ quantityDispatched: 2 }),
      });
      assert.equal(retry.status, 200);
    } finally {
      console.log = originalLog;
    }

    const whatsappLogs = logs.filter((l) => l.includes("WhatsApp no enviado"));
    assert.equal(whatsappLogs.length, 1, "debe intentar avisar una sola vez, no en cada PATCH");
    assert.ok(whatsappLogs[0].includes("3001234567"));
    assert.ok(whatsappLogs[0].includes(client.name));

    await prisma.dispatchItem.deleteMany({ where: { dispatchId: dispatch.id } });
    await prisma.dispatch.delete({ where: { id: dispatch.id } });
    await prisma.clientContact.deleteMany({ where: { clientId: client.id } });
    await prisma.client.delete({ where: { id: client.id } });
  });

  it("un cliente sin teléfono no rompe el flujo (no hay a quién avisar)", async () => {
    const client = await prisma.client.create({ data: { name: `TEST-WA-SINFONO-${Date.now()}` } });
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });

    const dispatchRes = await fetch(`${baseUrl}/api/dispatches`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ clientId: client.id, items: [{ productId: product.id, quantityRequested: 1 }] }),
    });
    const dispatch = (await dispatchRes.json()) as { id: number; items: { id: number }[] };

    const complete = await fetch(`${baseUrl}/api/dispatches/${dispatch.id}/items/${dispatch.items[0].id}`, {
      method: "PATCH",
      headers: headersFor("almacen"),
      body: JSON.stringify({ quantityDispatched: 1 }),
    });
    assert.equal(complete.status, 200);

    await prisma.dispatchItem.deleteMany({ where: { dispatchId: dispatch.id } });
    await prisma.dispatch.delete({ where: { id: dispatch.id } });
    await prisma.client.delete({ where: { id: client.id } });
  });
});

describe("auditoría", () => {
  it("devuelve 403 para un rol sin acceso (ventas)", async () => {
    const res = await fetch(`${baseUrl}/api/audit-log`, { headers: headersFor("ventas") });
    assert.equal(res.status, 403);
  });

  it("lista la bitácora paginada y filtra por tabla", async () => {
    // El create de cliente en el describe "clientes" ya deja rastro en audit_logs.
    const created = await fetch(`${baseUrl}/api/clients`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "TEST-AUDIT" }),
    });
    const client = (await created.json()) as { id: number };

    const res = await fetch(`${baseUrl}/api/audit-log?tableName=Client&pageSize=10`, { headers: headersFor("auditor") });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: { tableName: string; action: string }[]; total: number; page: number; pageSize: number };
    assert.ok(body.items.length > 0);
    assert.ok(body.items.every((i) => i.tableName === "Client"));
    assert.ok(body.items.some((i) => i.action === "create"));

    await prisma.client.delete({ where: { id: client.id } });
  });
});

describe("productos", () => {
  const sku = `TEST-SKU-${Date.now()}`;
  let productId = 0;

  after(async () => {
    if (productId) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
  });

  it("GET / es de solo lectura para cualquier rol autenticado", async () => {
    const res = await fetch(`${baseUrl}/api/products`, { headers: headersFor("ventas") });
    assert.equal(res.status, 200);
    const products = (await res.json()) as { sku: string }[];
    assert.ok(products.some((p) => p.sku === "BUL-001"));
  });

  it("crear/editar/desactivar exige gestión de producción (403 para ventas)", async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ sku, name: "Test", category: "bultos", unit: "kg", minStock: 0, unitPrice: 100 }),
    });
    assert.equal(res.status, 403);
  });

  it("crea un producto y rechaza SKU duplicado", async () => {
    const res = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ sku, name: "Test Producto", category: "bultos", unit: "kg", minStock: 5, unitPrice: 1000 }),
    });
    assert.equal(res.status, 201);
    const product = (await res.json()) as { id: number; active: boolean };
    productId = product.id;
    assert.equal(product.active, true);

    const dup = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ sku, name: "Otro", category: "bultos", unit: "kg", minStock: 0, unitPrice: 1 }),
    });
    assert.equal(dup.status, 409);
  });

  it("GET /:id/label devuelve un QR en data URL", async () => {
    const res = await fetch(`${baseUrl}/api/products/${productId}/label`, { headers: headersFor("produccion") });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { sku: string; qrDataUrl: string };
    assert.equal(body.sku, sku);
    assert.ok(body.qrDataUrl.startsWith("data:image"));
  });

  it("PATCH edita el producto y rechaza body vacío", async () => {
    const empty = await fetch(`${baseUrl}/api/products/${productId}`, {
      method: "PATCH",
      headers: headersFor("produccion"),
      body: JSON.stringify({}),
    });
    assert.equal(empty.status, 400);

    const res = await fetch(`${baseUrl}/api/products/${productId}`, {
      method: "PATCH",
      headers: headersFor("produccion"),
      body: JSON.stringify({ name: "Renombrado" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { name: string };
    assert.equal(body.name, "Renombrado");
  });

  it("DELETE desactiva el producto (deja de aparecer en el catálogo de venta) y POST /reactivate lo devuelve", async () => {
    const del = await fetch(`${baseUrl}/api/products/${productId}`, { method: "DELETE", headers: headersFor("produccion") });
    assert.equal(del.status, 200);
    const deleted = (await del.json()) as { active: boolean };
    assert.equal(deleted.active, false);

    const catalog = await fetch(`${baseUrl}/api/inventory/products`, { headers: authHeaders() });
    const catalogBody = (await catalog.json()) as { sku: string }[];
    assert.ok(!catalogBody.some((p) => p.sku === sku), "un producto inactivo no debe verse en el selector de venta");

    const reactivate = await fetch(`${baseUrl}/api/products/${productId}/reactivate`, { method: "POST", headers: headersFor("produccion") });
    assert.equal(reactivate.status, 200);
    const reactivated = (await reactivate.json()) as { active: boolean };
    assert.equal(reactivated.active, true);
  });
});

describe("usuarios y permisos", () => {
  const email = `test-user-${Date.now()}@x.com`;
  let userId = 0;
  let adminId = 0;

  before(async () => {
    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeaders() });
    const meBody = (await me.json()) as { id: number };
    adminId = meBody.id;
  });

  after(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it("devuelve 403 para un rol que no es admin", async () => {
    const res = await fetch(`${baseUrl}/api/users`, { headers: headersFor("ventas") });
    assert.equal(res.status, 403);
  });

  it("crea un usuario, rechaza email duplicado y nunca expone passwordHash", async () => {
    const res = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Test User", email, password: "password123", role: "calidad" }),
    });
    assert.equal(res.status, 201);
    const user = (await res.json()) as { id: number; role: string; passwordHash?: string };
    userId = user.id;
    assert.equal(user.role, "calidad");
    assert.equal(user.passwordHash, undefined);

    const dup = await fetch(`${baseUrl}/api/users`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Otro", email, password: "password123", role: "calidad" }),
    });
    assert.equal(dup.status, 409);
  });

  it("PATCH edita rol y nombre", async () => {
    const res = await fetch(`${baseUrl}/api/users/${userId}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ role: "auditor", name: "Test User Editado" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { role: string; name: string };
    assert.equal(body.role, "auditor");
    assert.equal(body.name, "Test User Editado");
  });

  it("un admin no puede autodesactivarse", async () => {
    const res = await fetch(`${baseUrl}/api/users/${adminId}`, { method: "DELETE", headers: authHeaders() });
    assert.equal(res.status, 400);
  });

  it("DELETE desactiva y bloquea el login; POST /reactivate lo restaura", async () => {
    const del = await fetch(`${baseUrl}/api/users/${userId}`, { method: "DELETE", headers: authHeaders() });
    assert.equal(del.status, 200);
    const deleted = (await del.json()) as { active: boolean };
    assert.equal(deleted.active, false);

    const loginBlocked = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    assert.equal(loginBlocked.status, 401);

    const reactivate = await fetch(`${baseUrl}/api/users/${userId}/reactivate`, { method: "POST", headers: authHeaders() });
    assert.equal(reactivate.status, 200);

    const loginOk = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    assert.equal(loginOk.status, 200);
  });
});

describe("almacén / WMS + ubicación pública por QR", () => {
  const code = `TEST-LOC-${Date.now()}`;
  let locationId = 0;
  let productId = 0;

  before(async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "ROL-PL-001" } });
    productId = product.id;
  });

  after(async () => {
    if (locationId) {
      await prisma.stockLocation.deleteMany({ where: { locationId } });
      await prisma.warehouseLocation.delete({ where: { id: locationId } }).catch(() => {});
    }
  });

  it("devuelve 403 para un rol sin acceso a Almacén", async () => {
    const res = await fetch(`${baseUrl}/api/warehouse/locations`, { headers: headersFor("ventas") });
    assert.equal(res.status, 403);
  });

  it("crea una ubicación (sin exponer el publicToken) y rechaza código duplicado", async () => {
    const res = await fetch(`${baseUrl}/api/warehouse/locations`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ code, label: "Estante de prueba" }),
    });
    assert.equal(res.status, 201);
    const location = (await res.json()) as Record<string, unknown>;
    locationId = location.id as number;
    assert.ok(!("publicToken" in location), "el publicToken no debe viajar en la respuesta de creación");

    const dup = await fetch(`${baseUrl}/api/warehouse/locations`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ code, label: "Otro" }),
    });
    assert.equal(dup.status, 400);
  });

  it("asigna stock, lo refleja en /stock, y el QR + la ruta pública sin login exponen lo mismo", async () => {
    const assign = await fetch(`${baseUrl}/api/warehouse/assign`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ productId, toLocationId: locationId, quantity: 15 }),
    });
    assert.equal(assign.status, 201);

    const stock = await fetch(`${baseUrl}/api/warehouse/stock`, { headers: headersFor("almacen") });
    assert.equal(stock.status, 200);
    const stockBody = (await stock.json()) as { productId: number; locations: { locationId: number; quantity: number }[] }[];
    const row = stockBody.find((p) => p.productId === productId);
    assert.ok(row);
    assert.ok(row!.locations.some((l) => l.locationId === locationId && l.quantity === 15));

    const qr = await fetch(`${baseUrl}/api/warehouse/locations/${locationId}/qr`, { headers: headersFor("almacen") });
    assert.equal(qr.status, 200);
    const qrBody = (await qr.json()) as { dataUrl: string; url: string };
    assert.ok(qrBody.dataUrl.startsWith("data:image"));
    const token = qrBody.url.split("/qr/")[1];
    assert.ok(token && token.length === 32, "el publicToken es un hex de 32 caracteres");

    const byToken = await fetch(`${baseUrl}/api/warehouse/locations/by-token/${token}`, { headers: headersFor("almacen") });
    assert.equal(byToken.status, 200);
    const byTokenBody = (await byToken.json()) as { id: number; code: string };
    assert.equal(byTokenBody.id, locationId);
    assert.equal(byTokenBody.code, code);

    // La ruta pública: SIN Authorization, debe funcionar igual.
    const publicRes = await fetch(`${baseUrl}/api/public/locations/${token}`);
    assert.equal(publicRes.status, 200);
    const publicBody = (await publicRes.json()) as { location: { code: string }; items: { productId: number; quantity: number }[] };
    assert.equal(publicBody.location.code, code);
    assert.ok(publicBody.items.some((i) => i.productId === productId && i.quantity === 15));

    const invalidToken = await fetch(`${baseUrl}/api/public/locations/token-que-no-existe`);
    assert.equal(invalidToken.status, 404);
  });

  it("mover stock entre ubicaciones valida que el origen tenga suficiente", async () => {
    const otherCode = `TEST-LOC-2-${Date.now()}`;
    const other = await prisma.warehouseLocation.create({
      data: { code: otherCode, label: "Segundo estante", publicToken: `${Date.now()}${Math.random()}`.padEnd(32, "0").slice(0, 32) },
    });

    const tooMuch = await fetch(`${baseUrl}/api/warehouse/assign`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ productId, toLocationId: other.id, quantity: 999999, fromLocationId: locationId }),
    });
    assert.equal(tooMuch.status, 400);

    const move = await fetch(`${baseUrl}/api/warehouse/assign`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ productId, toLocationId: other.id, quantity: 5, fromLocationId: locationId }),
    });
    assert.equal(move.status, 201);

    const fromRow = await prisma.stockLocation.findUnique({ where: { productId_locationId: { productId, locationId } } });
    const toRow = await prisma.stockLocation.findUnique({ where: { productId_locationId: { productId, locationId: other.id } } });
    assert.equal(Number(fromRow!.quantity), 10);
    assert.equal(Number(toRow!.quantity), 5);

    await prisma.stockLocation.deleteMany({ where: { locationId: other.id } });
    await prisma.warehouseLocation.delete({ where: { id: other.id } });
  });
});

describe("dashboard", () => {
  it("devuelve 403 para un rol que no es admin", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/resumen`, { headers: headersFor("ventas") });
    assert.equal(res.status, 403);
  });

  it("GET /resumen devuelve KPIs y 6 meses de ventas", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/resumen`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ventasUltimos6Meses: { mes: string; total: number }[];
      carteraPendiente: number;
      topClientesSaldo: unknown[];
    };
    assert.equal(body.ventasUltimos6Meses.length, 6);
    assert.equal(typeof body.carteraPendiente, "number");
    assert.ok(Array.isArray(body.topClientesSaldo));
  });

  it("GET /indicadores devuelve la tasa de aprobación de calidad", async () => {
    const res = await fetch(`${baseUrl}/api/dashboard/indicadores`, { headers: authHeaders() });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      topProductosDespachados: unknown[];
      calidad: { aprobadas: number; rechazadas: number; pctAprobacion: number | null };
    };
    assert.ok(Array.isArray(body.topProductosDespachados));
    assert.equal(typeof body.calidad.aprobadas, "number");
  });
});

describe("exportaciones", () => {
  it("GET /inventario devuelve un .xlsx no vacío para cualquier autenticado", async () => {
    const res = await fetch(`${baseUrl}/api/export/inventario`, { headers: headersFor("almacen") });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /spreadsheetml/);
    assert.match(res.headers.get("content-disposition") ?? "", /inventario\.xlsx/);
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 0);
  });

  it("/pedidos y /facturas exigen además rol de ventas (403 para almacén)", async () => {
    const res = await fetch(`${baseUrl}/api/export/pedidos`, { headers: headersFor("almacen") });
    assert.equal(res.status, 403);

    const ok = await fetch(`${baseUrl}/api/export/pedidos`, { headers: headersFor("ventas") });
    assert.equal(ok.status, 200);
  });

  it("GET /clientes devuelve un .xlsx para ventas", async () => {
    const res = await fetch(`${baseUrl}/api/export/clientes`, { headers: headersFor("ventas") });
    assert.equal(res.status, 200);
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 0);
  });
});

describe("notificaciones", () => {
  let calidadUserId = 0;
  let otherUserId = 0;
  let ownNotifId = 0;
  let otherNotifId = 0;

  before(async () => {
    const calidadUser = await prisma.user.findFirstOrThrow({ where: { email: "calidad@empresa.com" } });
    calidadUserId = calidadUser.id;
    const otherUser = await prisma.user.findFirstOrThrow({ where: { email: "auditor@empresa.com" } });
    otherUserId = otherUser.id;

    const own = await prisma.notification.create({
      data: { userId: calidadUserId, type: "test_notif", message: "TEST notificación propia", link: "/calidad" },
    });
    ownNotifId = own.id;
    const other = await prisma.notification.create({
      data: { userId: otherUserId, type: "test_notif", message: "TEST notificación ajena" },
    });
    otherNotifId = other.id;
  });

  after(async () => {
    await prisma.notification.deleteMany({ where: { id: { in: [ownNotifId, otherNotifId] } } });
  });

  it("lista solo las notificaciones propias, más recientes primero", async () => {
    const res = await fetch(`${baseUrl}/api/notifications`, { headers: headersFor("calidad") });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: number; message: string }[];
    assert.ok(body.some((n) => n.id === ownNotifId));
    assert.ok(!body.some((n) => n.id === otherNotifId), "no debe ver notificaciones de otro usuario");
  });

  it("unread-count refleja las no leídas y PATCH /:id/read las marca", async () => {
    const before1 = await fetch(`${baseUrl}/api/notifications/unread-count`, { headers: headersFor("calidad") });
    const beforeBody = (await before1.json()) as { count: number };
    assert.ok(beforeBody.count >= 1);

    const read = await fetch(`${baseUrl}/api/notifications/${ownNotifId}/read`, { method: "PATCH", headers: headersFor("calidad") });
    assert.equal(read.status, 200);
    const readBody = (await read.json()) as { read: boolean };
    assert.equal(readBody.read, true);

    const after1 = await fetch(`${baseUrl}/api/notifications/unread-count`, { headers: headersFor("calidad") });
    const afterBody = (await after1.json()) as { count: number };
    assert.equal(afterBody.count, beforeBody.count - 1);
  });

  it("no puede marcar como leída una notificación de otro usuario (404)", async () => {
    const res = await fetch(`${baseUrl}/api/notifications/${otherNotifId}/read`, { method: "PATCH", headers: headersFor("calidad") });
    assert.equal(res.status, 404);
  });

  it("PATCH /read-all marca todas las propias como leídas", async () => {
    const fresh = await prisma.notification.create({
      data: { userId: calidadUserId, type: "test_notif", message: "TEST notif fresca sin leer" },
    });
    const res = await fetch(`${baseUrl}/api/notifications/read-all`, { method: "PATCH", headers: headersFor("calidad") });
    assert.equal(res.status, 200);
    const remaining = await prisma.notification.count({ where: { userId: calidadUserId, read: false } });
    assert.equal(remaining, 0);
    await prisma.notification.delete({ where: { id: fresh.id } });
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
