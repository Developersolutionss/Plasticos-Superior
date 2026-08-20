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
import { rawMaterialsRouter } from "../../server/src/routes/rawMaterials";
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
  app.use("/api/raw-materials", rawMaterialsRouter);
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

  it("un operario de planta no puede ver Existencias/alertas/catálogo (solo su rol de estación)", async () => {
    const routes = ["/api/inventory", "/api/inventory/alerts", "/api/inventory/products"];
    for (const route of routes) {
      const res = await fetch(`${baseUrl}${route}`, { headers: headersFor("operario_extrusion") });
      assert.equal(res.status, 403, `${route} debería rechazar a un operario`);
    }
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

describe("materia prima", () => {
  let productId = 0;
  let materialId = 0;
  const code = `TEST-RM-${Date.now()}`;

  before(async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });
    productId = product.id;
  });

  after(async () => {
    if (materialId) {
      await prisma.rawMaterialMovement.deleteMany({ where: { rawMaterialId: materialId } });
      await prisma.rawMaterialStock.deleteMany({ where: { rawMaterialId: materialId } });
      await prisma.rawMaterial.delete({ where: { id: materialId } }).catch(() => {});
    }
  });

  it("un operario no puede ver el catálogo/stock/alertas", async () => {
    const routes = ["/api/raw-materials", "/api/raw-materials/stock", "/api/raw-materials/alerts"];
    for (const route of routes) {
      const res = await fetch(`${baseUrl}${route}`, { headers: headersFor("operario_extrusion") });
      assert.equal(res.status, 403, `${route} debería rechazar a un operario`);
    }
  });

  it("crea una materia prima, rechaza código duplicado y ventas no puede crear", async () => {
    const denied = await fetch(`${baseUrl}/api/raw-materials`, {
      method: "POST",
      headers: headersFor("ventas"),
      body: JSON.stringify({ code }),
    });
    assert.equal(denied.status, 403);

    const res = await fetch(`${baseUrl}/api/raw-materials`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ code, name: "Test", minStock: 10 }),
    });
    assert.equal(res.status, 201);
    const material = (await res.json()) as { id: number; code: string };
    materialId = material.id;

    const dup = await fetch(`${baseUrl}/api/raw-materials`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ code }),
    });
    assert.equal(dup.status, 409);
  });

  it("crear con código en minúsculas se normaliza a mayúsculas (matchea contra specs.materiaPrima al cerrar una OP)", async () => {
    const lower = `${code}-lower`;
    const res = await fetch(`${baseUrl}/api/raw-materials`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ code: lower.toLowerCase() }),
    });
    assert.equal(res.status, 201);
    const created = (await res.json()) as { id: number; code: string };
    assert.equal(created.code, lower.toUpperCase());
    await prisma.rawMaterial.delete({ where: { id: created.id } });
  });

  it("ajusta stock (compra) con nota, lo lista en /stock y la nota queda en el historial de movimientos", async () => {
    const res = await fetch(`${baseUrl}/api/raw-materials/${materialId}/adjust`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ quantity: 50, notes: "Compra a proveedor de prueba" }),
    });
    assert.equal(res.status, 201);

    const stock = (await (await fetch(`${baseUrl}/api/raw-materials/stock`, { headers: headersFor("produccion") })).json()) as {
      id: number;
      currentStock: number;
      belowMinimum: boolean;
    }[];
    const mine = stock.find((s) => s.id === materialId);
    assert.equal(mine?.currentStock, 50);
    assert.equal(mine?.belowMinimum, false);

    const movements = (await (
      await fetch(`${baseUrl}/api/raw-materials/movements?rawMaterialId=${materialId}`, { headers: headersFor("produccion") })
    ).json()) as { items: { movementType: string; quantity: string; notes: string | null }[] };
    assert.equal(movements.items.length, 1);
    assert.equal(movements.items[0].notes, "Compra a proveedor de prueba");
    assert.equal(movements.items[0].movementType, "compra");
  });

  it("cerrar una OP de Extrusión descuenta el kg cargado por cada insumo y avisa (sin bloquear) las refs que no matchean", async () => {
    const order = await prisma.productionOrder.create({
      data: {
        orderNumber: `OP-TEST-${Date.now()}`,
        station: "extrusion",
        productId,
        quantityPlanned: 10,
        specs: { materiaPrima: [{ ref: code, pct: 100, kg: 8 }, { ref: "NO-EXISTE-REF", pct: 0, kg: 3 }] },
      },
    });
    await prisma.productionRoll.create({ data: { productionOrderId: order.id, operatorName: "Op", weightKg: 10 } });

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/close`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; skippedRawMaterialRefs: string[] };
    assert.equal(body.status, "finalizada");
    assert.deepEqual(body.skippedRawMaterialRefs, ["NO-EXISTE-REF"]);

    const stock = (await (await fetch(`${baseUrl}/api/raw-materials/stock`, { headers: headersFor("produccion") })).json()) as {
      id: number;
      currentStock: number;
    }[];
    const mine = stock.find((s) => s.id === materialId);
    assert.equal(mine?.currentStock, 42, "50 - 8 = 42");

    // Reabrir la OP debe devolver exactamente el kg descontado (lee el
    // movimiento real logueado, no vuelve a leer specs.materiaPrima).
    const reopen = await fetch(`${baseUrl}/api/production-orders/${order.id}/reopen`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(reopen.status, 200);
    const reopenBody = (await reopen.json()) as { status: string; reversedRawMaterials: { code: string; kg: number }[] };
    assert.equal(reopenBody.status, "en_proceso");
    assert.deepEqual(reopenBody.reversedRawMaterials, [{ code, kg: 8 }]);

    const stockReabierta = (await (await fetch(`${baseUrl}/api/raw-materials/stock`, { headers: headersFor("produccion") })).json()) as {
      id: number;
      currentStock: number;
    }[];
    assert.equal(stockReabierta.find((s) => s.id === materialId)?.currentStock, 50, "42 + 8 = 50, vuelve a como estaba");

    // Segundo ciclo cerrar→reabrir sobre la MISMA OP (specs corregidas a un
    // kg distinto): el historial de raw_material_movements para este
    // referenceId ya trae la consumición original Y su reversión — hay que
    // devolver solo el neto pendiente de este segundo cierre, no volver a
    // sumar la reversión de la primera vuelta encima.
    await prisma.productionOrder.update({ where: { id: order.id }, data: { specs: { materiaPrima: [{ ref: code, pct: 100, kg: 6 }] } } });

    const close2 = await fetch(`${baseUrl}/api/production-orders/${order.id}/close`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(close2.status, 200);

    const stockTrasCierre2 = (await (await fetch(`${baseUrl}/api/raw-materials/stock`, { headers: headersFor("produccion") })).json()) as {
      id: number;
      currentStock: number;
    }[];
    assert.equal(stockTrasCierre2.find((s) => s.id === materialId)?.currentStock, 44, "50 - 6 = 44");

    const reopen2 = await fetch(`${baseUrl}/api/production-orders/${order.id}/reopen`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(reopen2.status, 200);
    const reopen2Body = (await reopen2.json()) as { reversedRawMaterials: { code: string; kg: number }[] };
    assert.deepEqual(reopen2Body.reversedRawMaterials, [{ code, kg: 6 }], "solo revierte el neto pendiente (6), no el 8 de la vuelta anterior");

    const stockFinal = (await (await fetch(`${baseUrl}/api/raw-materials/stock`, { headers: headersFor("produccion") })).json()) as {
      id: number;
      currentStock: number;
    }[];
    assert.equal(stockFinal.find((s) => s.id === materialId)?.currentStock, 50, "44 + 6 = 50, vuelve a como estaba (no 56)");

    await prisma.productionRoll.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("desactiva y reactiva; desactivada no aparece afectada en /stock (sigue existiendo, solo cambia active)", async () => {
    const off = await fetch(`${baseUrl}/api/raw-materials/${materialId}`, { method: "DELETE", headers: headersFor("produccion") });
    assert.equal(off.status, 200);
    const offBody = (await off.json()) as { active: boolean };
    assert.equal(offBody.active, false);

    const on = await fetch(`${baseUrl}/api/raw-materials/${materialId}/reactivate`, { method: "POST", headers: headersFor("produccion") });
    assert.equal(on.status, 200);
    const onBody = (await on.json()) as { active: boolean };
    assert.equal(onBody.active, true);
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

describe("órdenes de producción · una OP por proceso (derivación, rollos, calidad, planeación)", () => {
  let productId = 0;

  before(async () => {
    const product = await prisma.product.findFirstOrThrow({ where: { sku: "BUL-001" } });
    productId = product.id;
  });

  it("devuelve 403 para un rol sin acceso al módulo (ventas)", async () => {
    const res = await fetch(`${baseUrl}/api/production-orders`, { headers: headersFor("ventas") });
    assert.equal(res.status, 403);
  });

  it("crea una OP con numeración OP-XXXXX, estación y specs de plantilla", async () => {
    const res = await fetch(`${baseUrl}/api/production-orders`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({
        station: "extrusion",
        productId,
        quantityPlanned: 50,
        specs: { formaMaterial: "Tubular", materiaPrima: [{ ref: "ALTA", pct: 70 }] },
      }),
    });
    assert.equal(res.status, 201);
    const order = (await res.json()) as { id: number; orderNumber: string; status: string; station: string; specs: any };
    assert.match(order.orderNumber, /^OP-\d{5}$/);
    assert.equal(order.status, "pendiente");
    assert.equal(order.station, "extrusion");
    assert.equal(order.specs.formaMaterial, "Tubular");
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("un operario no puede registrar rollos en una OP de otra estación", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "impresion", productId, quantityPlanned: 10 },
    });
    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/rolls`, {
      method: "POST",
      headers: headersFor("operario_extrusion"),
      body: JSON.stringify({ weightKg: 5 }),
    });
    assert.equal(res.status, 403);
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("cargar un rollo pasa la OP a en_proceso; el operario sale del JWT, no del body; gestión puede borrarlo", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "extrusion", productId, quantityPlanned: 10 },
    });
    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/rolls`, {
      method: "POST",
      headers: headersFor("operario_extrusion"),
      // operatorName en el body es ignorado a propósito (se toma del JWT) —
      // se manda igual acá para confirmar que NO pisa al usuario logueado.
      body: JSON.stringify({ shift: "Turno 1", operatorName: "Alguien Falso", label: "R-1", weightKg: 5, wasteKg: 0.5, details: { pResistencia: "SI" } }),
    });
    assert.equal(res.status, 201);
    const roll = (await res.json()) as { id: number; operatorName: string };
    assert.equal(roll.operatorName, "Operario Extrusión", "el operario debe salir del JWT, no del body");

    const updated = await prisma.productionOrder.findUnique({ where: { id: order.id } });
    assert.equal(updated!.status, "en_proceso");

    const del = await fetch(`${baseUrl}/api/production-orders/${order.id}/rolls/${roll.id}`, {
      method: "DELETE",
      headers: headersFor("produccion"),
    });
    assert.equal(del.status, 204);

    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("derivación: extrusión → sellado hereda producto/cantidad; sellado no deriva (400)", async () => {
    const parent = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "extrusion", productId, quantityPlanned: 40 },
    });

    const bad = await fetch(`${baseUrl}/api/production-orders/${parent.id}/derive`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ station: "extrusion" }),
    });
    assert.equal(bad.status, 400, "extrusión no puede derivar a extrusión");

    const res = await fetch(`${baseUrl}/api/production-orders/${parent.id}/derive`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ station: "sellado" }),
    });
    assert.equal(res.status, 201);
    const derived = (await res.json()) as { id: number; station: string; parentOrderId: number; productId: number; quantityPlanned: unknown };
    assert.equal(derived.station, "sellado");
    assert.equal(derived.parentOrderId, parent.id);
    assert.equal(derived.productId, productId);
    assert.equal(Number(derived.quantityPlanned), 40);

    const badFinal = await fetch(`${baseUrl}/api/production-orders/${derived.id}/derive`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ station: "precorte" }),
    });
    assert.equal(badFinal.status, 400, "una OP de sellado es proceso final, no deriva");

    await prisma.productionOrder.delete({ where: { id: derived.id } });
    await prisma.productionOrder.delete({ where: { id: parent.id } });
  });

  it("el rollo de origen escaneado (sourceRollId) tiene que pertenecer a la OP padre real, no a cualquier OP", async () => {
    const parentA = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "extrusion", productId, quantityPlanned: 10 },
    });
    const rollAjeno = await prisma.productionRoll.create({
      data: { productionOrderId: parentA.id, operatorName: "Op", weightKg: 5 },
    });

    const parentB = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}b`, station: "extrusion", productId, quantityPlanned: 10 },
    });
    const derivedFromB = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}c`, station: "impresion", productId, quantityPlanned: 10, parentOrderId: parentB.id },
    });

    const rejected = await fetch(`${baseUrl}/api/production-orders/${derivedFromB.id}/rolls`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ weightKg: 5, sourceRollId: rollAjeno.id }),
    });
    assert.equal(rejected.status, 400, "un rollo de una OP no emparentada debe rechazarse");

    await prisma.productionRoll.deleteMany({ where: { productionOrderId: parentA.id } });
    await prisma.productionOrder.delete({ where: { id: derivedFromB.id } });
    await prisma.productionOrder.delete({ where: { id: parentB.id } });
    await prisma.productionOrder.delete({ where: { id: parentA.id } });
  });

  it("cerrar una OP de extrusión la finaliza directo sin mover stock; sin rollos se rechaza", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "extrusion", productId, quantityPlanned: 10 },
    });

    const sinRollos = await fetch(`${baseUrl}/api/production-orders/${order.id}/close`, {
      method: "POST",
      headers: headersFor("operario_extrusion"),
    });
    assert.equal(sinRollos.status, 400, "no se cierra una OP sin rollos");

    await prisma.productionRoll.create({ data: { productionOrderId: order.id, operatorName: "Op", weightKg: 10 } });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId } });

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/close`, {
      method: "POST",
      headers: headersFor("operario_extrusion"),
    });
    assert.equal(res.status, 200);
    const closed = (await res.json()) as { status: string };
    assert.equal(closed.status, "finalizada", "extrusión no pasa por calidad");

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId } });
    assert.equal(Number(stockDespues?.currentQuantity ?? 0), Number(stockAntes?.currentQuantity ?? 0), "extrusión no mueve stock");

    await prisma.productionRoll.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("cerrar una OP final (sellado) la deja pendiente_calidad y notifica a Calidad (sin mover stock)", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "sellado", productId, quantityPlanned: 10 },
    });
    await prisma.productionRoll.create({ data: { productionOrderId: order.id, operatorName: "Op", weightKg: 12 } });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId } });

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/close`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(res.status, 200);

    const updated = await prisma.productionOrder.findUnique({ where: { id: order.id } });
    assert.equal(updated!.status, "pendiente_calidad");

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId } });
    assert.equal(Number(stockDespues?.currentQuantity ?? 0), Number(stockAntes?.currentQuantity ?? 0), "el cierre no mueve stock todavía");

    const notif = await prisma.notification.findFirst({
      where: { type: "op_pendiente_calidad", message: { contains: order.orderNumber } },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(notif, "Calidad debió recibir una notificación");
    assert.equal(notif!.link, "/calidad");

    await prisma.notification.delete({ where: { id: notif!.id } });
    await prisma.productionRoll.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("Calidad aprueba: genera la entrada de inventario con la suma de kg de los rollos y finaliza la OP", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "precorte", productId, quantityPlanned: 10, status: "pendiente_calidad" },
    });
    await prisma.productionRoll.create({ data: { productionOrderId: order.id, operatorName: "Op", weightKg: 5 } });
    await prisma.productionRoll.create({ data: { productionOrderId: order.id, operatorName: "Op", weightKg: 3 } });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId } });

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/quality-check`, {
      method: "POST",
      headers: headersFor("calidad"),
      body: JSON.stringify({ result: "aprobado" }),
    });
    assert.equal(res.status, 201);

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId } });
    assert.equal(Number(stockDespues!.currentQuantity), Number(stockAntes?.currentQuantity ?? 0) + 8, "entra la suma de los rollos (5+3)");

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
    await prisma.productionRoll.deleteMany({ where: { productionOrderId: order.id } });
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

  it("reabrir exige gestión de producción (403 para un operario)", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10, status: "detenida" },
    });
    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/reopen`, {
      method: "POST",
      headers: headersFor("operario_extrusion"),
    });
    assert.equal(res.status, 403);
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("no se puede reabrir una OP que ya está abierta (400)", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10, status: "en_proceso" },
    });
    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/reopen`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(res.status, 400);
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("reabrir una OP con calidad APROBADA revierte la entrada de inventario, borra el control y vuelve a en_proceso", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "precorte", productId, quantityPlanned: 10, status: "pendiente_calidad" },
    });
    await prisma.productionRoll.create({ data: { productionOrderId: order.id, operatorName: "Op", weightKg: 5 } });
    await prisma.productionRoll.create({ data: { productionOrderId: order.id, operatorName: "Op", weightKg: 3 } });
    const stockAntes = await prisma.inventoryStock.findUnique({ where: { productId } });

    const approve = await fetch(`${baseUrl}/api/production-orders/${order.id}/quality-check`, {
      method: "POST",
      headers: headersFor("calidad"),
      body: JSON.stringify({ result: "aprobado" }),
    });
    assert.equal(approve.status, 201);
    const stockAprobado = await prisma.inventoryStock.findUnique({ where: { productId } });
    assert.equal(Number(stockAprobado!.currentQuantity), Number(stockAntes?.currentQuantity ?? 0) + 8);

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/reopen`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; reversedProductKg: number };
    assert.equal(body.status, "en_proceso");
    assert.equal(body.reversedProductKg, 8);

    const stockDespues = await prisma.inventoryStock.findUnique({ where: { productId } });
    assert.equal(
      Number(stockDespues!.currentQuantity),
      Number(stockAntes?.currentQuantity ?? 0),
      "el stock vuelve exactamente a como estaba antes de aprobar"
    );

    const check = await prisma.qualityCheck.findUnique({ where: { productionOrderId: order.id } });
    assert.equal(check, null, "el control de calidad se borra al reabrir, para poder volver a pasar por Calidad");

    // Ya no se puede reabrir de nuevo (está en_proceso, no en un estado reabrible).
    const again = await fetch(`${baseUrl}/api/production-orders/${order.id}/reopen`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(again.status, 400);

    await prisma.inventoryMovement.deleteMany({ where: { referenceType: "manual_adjustment", productId, createdAt: { gte: order.createdAt } } });
    await prisma.productionRoll.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.productionOrder.delete({ where: { id: order.id } });
    await prisma.inventoryStock.update({ where: { productId }, data: { currentQuantity: stockAntes?.currentQuantity ?? 0 } });
  });

  it("reabrir una OP con calidad RECHAZADA solo borra el control (nunca movió stock)", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, productId, quantityPlanned: 10, status: "pendiente_calidad" },
    });
    const reject = await fetch(`${baseUrl}/api/production-orders/${order.id}/quality-check`, {
      method: "POST",
      headers: headersFor("calidad"),
      body: JSON.stringify({ result: "rechazado" }),
    });
    assert.equal(reject.status, 201);

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/reopen`, {
      method: "POST",
      headers: headersFor("produccion"),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; reversedProductKg: number };
    assert.equal(body.status, "en_proceso");
    assert.equal(body.reversedProductKg, 0);

    const check = await prisma.qualityCheck.findUnique({ where: { productionOrderId: order.id } });
    assert.equal(check, null);

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
    const order = (await generate.json()) as { id: number; pedidoVersionItemId: number; station: string; clientId: number | null };
    assert.equal(order.pedidoVersionItemId, target.pedidoVersionItemId);
    assert.equal(order.station, "extrusion", "la OP de Planeación nace como el proceso base");
    assert.ok(order.clientId, "hereda el cliente del pedido");

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

  it("GET /:id (Trazabilidad) devuelve el detalle completo (rollos, derivación) y 404 si no existe", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "extrusion", productId, quantityPlanned: 10 },
    });
    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}`, { headers: headersFor("auditor") });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: number; product: { sku: string }; rolls: unknown[]; derivedOrders: unknown[]; attachments: unknown[] };
    assert.equal(body.id, order.id);
    assert.equal(body.product.sku, "BUL-001");
    assert.ok(Array.isArray(body.rolls));
    assert.ok(Array.isArray(body.derivedOrders));
    assert.ok(Array.isArray(body.attachments));

    const notFound = await fetch(`${baseUrl}/api/production-orders/999999999`, { headers: headersFor("auditor") });
    assert.equal(notFound.status, 404);

    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("GET /:id/report.pdf devuelve el reporte consolidado en PDF", async () => {
    const order = await prisma.productionOrder.create({
      data: {
        orderNumber: `OP-TEST-${Date.now()}`,
        station: "extrusion",
        productId,
        quantityPlanned: 100,
        specs: { formaMaterial: "Tubular", materiaPrima: [{ ref: "ALTA", pct: 70, lote: "L-1" }], maquina: "Extrusora 1" },
      },
    });
    await prisma.productionRoll.create({
      data: { productionOrderId: order.id, shift: "Turno 1", operatorName: "Op", label: "R-1", weightKg: 50, details: { pResistencia: "SI" } },
    });

    const res = await fetch(`${baseUrl}/api/production-orders/${order.id}/report.pdf`, { headers: headersFor("produccion") });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/pdf/);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
    assert.ok(buffer.length > 1000, "el PDF debe tener contenido real");

    await prisma.productionRoll.deleteMany({ where: { productionOrderId: order.id } });
    await prisma.productionOrder.delete({ where: { id: order.id } });
  });

  it("PATCH /:id edita specs solo mientras la OP está abierta", async () => {
    const order = await prisma.productionOrder.create({
      data: { orderNumber: `OP-TEST-${Date.now()}`, station: "sellado", productId, quantityPlanned: 10, specs: { tipoMaterial: "Tubular" } },
    });

    const ok = await fetch(`${baseUrl}/api/production-orders/${order.id}`, {
      method: "PATCH",
      headers: headersFor("produccion"),
      body: JSON.stringify({ specs: { tipoMaterial: "Semitubular", medAncho: "14" }, quantityPlanned: 20 }),
    });
    assert.equal(ok.status, 200);
    const updated = (await ok.json()) as { specs: any; quantityPlanned: unknown };
    assert.equal(updated.specs.medAncho, "14");
    assert.equal(Number(updated.quantityPlanned), 20);

    await prisma.productionOrder.update({ where: { id: order.id }, data: { status: "finalizada" } });
    const cerrada = await fetch(`${baseUrl}/api/production-orders/${order.id}`, {
      method: "PATCH",
      headers: headersFor("produccion"),
      body: JSON.stringify({ specs: { tipoMaterial: "Tubular" } }),
    });
    assert.equal(cerrada.status, 400, "una OP cerrada no se edita");

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

describe("productos", () => {
  it("crea un producto con el rol correcto, rechaza el rol incorrecto, y rechaza SKU duplicado", async () => {
    const sku = `TEST-SKU-${Date.now()}`;
    const forbidden = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor("almacen"),
      body: JSON.stringify({ sku, name: "Producto de test", category: "bultos", unit: "unidad", minStock: 1, unitPrice: 100 }),
    });
    assert.equal(forbidden.status, 403);

    const res = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor("produccion"),
      body: JSON.stringify({ sku, name: "Producto de test", category: "bultos", unit: "unidad", minStock: 1, unitPrice: 100 }),
    });
    assert.equal(res.status, 201);
    const product = (await res.json()) as { id: number };

    const dup = await fetch(`${baseUrl}/api/products`, {
      method: "POST",
      headers: headersFor("produccion"),
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
        headers: headersFor("produccion"),
        body: JSON.stringify({ sku, name: "Producto B", category: "bultos", unit: "unidad", minStock: 1, unitPrice: 100 }),
      })
    ).json()) as { id: number };

    const patched = await fetch(`${baseUrl}/api/products/${created.id}`, {
      method: "PATCH",
      headers: headersFor("produccion"),
      body: JSON.stringify({ name: "Producto B editado" }),
    });
    assert.equal(patched.status, 200);

    const deactivated = await fetch(`${baseUrl}/api/products/${created.id}`, { method: "DELETE", headers: headersFor("produccion") });
    assert.equal(deactivated.status, 200);
    assert.equal(((await deactivated.json()) as { active: boolean }).active, false);

    const filtered = (await (await fetch(`${baseUrl}/api/inventory/products`, { headers: authHeaders() })).json()) as { id: number }[];
    assert.ok(!filtered.some((p) => p.id === created.id));
    const full = (await (await fetch(`${baseUrl}/api/products`, { headers: authHeaders() })).json()) as { id: number }[];
    assert.ok(full.some((p) => p.id === created.id));

    const reactivated = await fetch(`${baseUrl}/api/products/${created.id}/reactivate`, { method: "POST", headers: headersFor("produccion") });
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
      headers: headersFor("produccion"),
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
      headers: headersFor("ventas"),
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
    const ok = await fetch(`${baseUrl}/api/inventory/movements`, { headers: headersFor("almacen") });
    assert.equal(ok.status, 200);
    const okBody = (await ok.json()) as { items: unknown[] };
    assert.ok(Array.isArray(okBody.items));

    const forbidden = await fetch(`${baseUrl}/api/inventory/movements`, { headers: headersFor("ventas") });
    assert.equal(forbidden.status, 403);

    const badQuery = await fetch(`${baseUrl}/api/inventory/movements?productId=abc`, { headers: headersFor("almacen") });
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

    const forbidden = await fetch(`${baseUrl}/api/dashboard/indicadores`, { headers: headersFor("almacen") });
    assert.equal(forbidden.status, 403);
  });
});

describe("exportaciones", () => {
  it("inventario es accesible para cualquier autenticado; pedidos requiere Ventas", async () => {
    const inv = await fetch(`${baseUrl}/api/export/inventario`, { headers: headersFor("almacen") });
    assert.equal(inv.status, 200);
    assert.ok(inv.headers.get("content-type")?.includes("spreadsheetml"));

    const forbidden = await fetch(`${baseUrl}/api/export/pedidos`, { headers: headersFor("almacen") });
    assert.equal(forbidden.status, 403);

    const allowed = await fetch(`${baseUrl}/api/export/pedidos`, { headers: headersFor("ventas") });
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
      headers: headersFor("ventas"),
      body: JSON.stringify({
        clientId: acme!.id,
        dueDate: "2020-01-01",
        items: [{ productId: bulto!.id, quantity: 1, unitPrice: 1000 }],
      }),
    });
    assert.equal(res.status, 201);
    const factura = (await res.json()) as { id: number; invoiceNumber: string };

    const cartera = (await (
      await fetch(`${baseUrl}/api/clients/${acme!.id}/cartera`, { headers: headersFor("ventas") })
    ).json()) as { facturasPendientes: { id: number; vencida: boolean }[] };
    const found = cartera.facturasPendientes.find((f) => f.id === factura.id);
    assert.ok(found, "la factura recién creada debe aparecer como pendiente");
    assert.equal(found!.vencida, true);

    const pdf = await fetch(`${baseUrl}/api/facturas/${factura.id}/pdf`, { headers: headersFor("ventas") });
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
        headers: headersFor("ventas"),
        body: JSON.stringify({ clientId: acme!.id, items: [{ productId: bulto!.id, quantity: 1, unitPrice: 1000 }] }),
      })
    ).json()) as { id: number };

    const pdf = await fetch(`${baseUrl}/api/cotizaciones/${created.id}/pdf`, { headers: headersFor("ventas") });
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
        headers: headersFor("almacen"),
        body: JSON.stringify({ clientId: acme!.id, items: [{ productId: bulto!.id, quantityRequested: 1 }] }),
      })
    ).json()) as { id: number; items: { id: number }[] };

    const res = await fetch(`${baseUrl}/api/dispatches/${created.id}/items/${created.items[0].id}`, {
      method: "PATCH",
      headers: headersFor("almacen"),
      body: JSON.stringify({ quantityDispatched: 1 }),
    });
    assert.equal(res.status, 200);

    const dispatch = await prisma.dispatch.findUnique({ where: { id: created.id } });
    assert.equal(dispatch!.status, "despachado");

    await prisma.dispatchItem.deleteMany({ where: { dispatchId: created.id } });
    await prisma.inventoryMovement.deleteMany({ where: { referenceType: "dispatch_item", referenceId: created.items[0].id } });
    await prisma.dispatch.delete({ where: { id: created.id } });
    // applyMovement() ya restó 1 al stock real de BUL-001 (currentQuantity)
    // al marcar el ítem despachado — borrar el movimiento no revierte ese
    // efecto solo, hay que reponerlo a mano o el stock del seed se va
    // achicando 1 unidad cada vez que corre la suite.
    await prisma.inventoryStock.update({ where: { productId: bulto!.id }, data: { currentQuantity: { increment: 1 } } });
  });
});

describe("almacén · ubicación por token", () => {
  it("resuelve el token del QR a la ubicación correcta, 404 con token inválido, 403 con rol incorrecto", async () => {
    const code = `TEST-LOC-${Date.now()}`;
    const location = (await (
      await fetch(`${baseUrl}/api/warehouse/locations`, {
        method: "POST",
        headers: headersFor("almacen"),
        body: JSON.stringify({ code, label: "Ubicación de test" }),
      })
    ).json()) as { id: number; code: string };

    const qr = (await (
      await fetch(`${baseUrl}/api/warehouse/locations/${location.id}/qr`, { headers: headersFor("almacen") })
    ).json()) as { url: string };
    const locToken = qr.url.split("/").pop()!;

    const resolved = await fetch(`${baseUrl}/api/warehouse/locations/by-token/${locToken}`, { headers: headersFor("almacen") });
    assert.equal(resolved.status, 200);
    const resolvedBody = (await resolved.json()) as { id: number; code: string };
    assert.equal(resolvedBody.id, location.id);
    assert.equal(resolvedBody.code, code);

    const notFound = await fetch(`${baseUrl}/api/warehouse/locations/by-token/token-invalido`, { headers: headersFor("almacen") });
    assert.equal(notFound.status, 404);

    const forbidden = await fetch(`${baseUrl}/api/warehouse/locations/by-token/${locToken}`, { headers: headersFor("ventas") });
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
