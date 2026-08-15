import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { getStockByCategory } from "../services/stockService";
import { buildExcelBuffer, humanize } from "../services/exportExcel";

export const exportRouter = Router();
exportRouter.use(requireAuth);

const COMPANY = "Plásticos Superior S.A.S.";

function sendXlsx(res: import("express").Response, filename: string, buffer: Buffer) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

/** Mismo nivel de acceso que inventory.ts hoy: cualquier usuario autenticado. */
exportRouter.get("/inventario", async (_req, res) => {
  const stock = await getStockByCategory();
  const buffer = await buildExcelBuffer(
    "Inventario",
    [
      { header: "SKU", key: "sku" },
      { header: "Producto", key: "name", width: 30 },
      { header: "Categoría", key: "category" },
      { header: "Medida", key: "measure" },
      { header: "Unidad", key: "unit" },
      { header: "Stock actual", key: "currentStock", format: "number" },
      { header: "Stock mínimo", key: "minStock", format: "number" },
      { header: "Bajo mínimo", key: "belowMinimo" },
    ],
    stock.map((p) => ({ ...p, category: humanize(p.category), belowMinimo: p.belowMinimum ? "Sí" : "No" })),
    { title: `Inventario — ${COMPANY}` }
  );
  sendXlsx(res, "inventario.xlsx", buffer);
});

const requireVentas = requireRole(...ROLES.VENTAS);

exportRouter.get("/pedidos", requireVentas, async (_req, res) => {
  const pedidos = await prisma.pedido.findMany({
    include: { client: true, versions: { orderBy: { versionNumber: "desc" }, take: 1, include: { items: true } } },
    orderBy: { createdAt: "desc" },
  });
  const rows = pedidos.map((p) => {
    const v = p.versions[0];
    const total = v?.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0) ?? 0;
    return {
      orderNumber: p.orderNumber,
      cliente: p.client.name,
      estado: humanize(p.status),
      version: p.currentVersion,
      total,
      fecha: p.createdAt,
    };
  });
  const buffer = await buildExcelBuffer(
    "Pedidos",
    [
      { header: "Pedido", key: "orderNumber" },
      { header: "Cliente", key: "cliente", width: 30 },
      { header: "Estado", key: "estado" },
      { header: "Versión", key: "version", format: "number" },
      { header: "Total", key: "total", format: "currency" },
      { header: "Fecha", key: "fecha", format: "date" },
    ],
    rows,
    { title: `Pedidos — ${COMPANY}` }
  );
  sendXlsx(res, "pedidos.xlsx", buffer);
});

exportRouter.get("/facturas", requireVentas, async (_req, res) => {
  const facturas = await prisma.factura.findMany({
    include: { client: true, items: true, payments: true },
    orderBy: { createdAt: "desc" },
  });
  const rows = facturas.map((f) => {
    const total = f.items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
    const pagado = f.payments.reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      invoiceNumber: f.invoiceNumber,
      cliente: f.client.name,
      estado: humanize(f.status),
      total,
      pagado,
      saldo: total - pagado,
      fecha: f.createdAt,
    };
  });
  const buffer = await buildExcelBuffer(
    "Facturas",
    [
      { header: "Factura", key: "invoiceNumber" },
      { header: "Cliente", key: "cliente", width: 30 },
      { header: "Estado", key: "estado" },
      { header: "Total", key: "total", format: "currency" },
      { header: "Pagado", key: "pagado", format: "currency" },
      { header: "Saldo", key: "saldo", format: "currency" },
      { header: "Fecha", key: "fecha", format: "date" },
    ],
    rows,
    { title: `Facturas — ${COMPANY}` }
  );
  sendXlsx(res, "facturas.xlsx", buffer);
});

exportRouter.get("/clientes", requireVentas, async (_req, res) => {
  const clients = await prisma.client.findMany({
    where: { active: true },
    include: { facturas: { where: { status: { not: "anulada" } }, include: { items: true, payments: true } } },
    orderBy: { name: "asc" },
  });
  const rows = clients.map((c) => {
    const saldoPendiente = c.facturas.reduce((sum, f) => {
      const total = f.items.reduce((s, it) => s + Number(it.quantity) * Number(it.unitPrice), 0);
      const paid = f.payments.reduce((s, p) => s + Number(p.amount), 0);
      return sum + (total - paid);
    }, 0);
    return {
      nombre: c.name,
      limiteCredito: Number(c.creditLimit ?? 0),
      saldoPendiente,
    };
  });
  const buffer = await buildExcelBuffer(
    "Clientes",
    [
      { header: "Cliente", key: "nombre", width: 30 },
      { header: "Límite de crédito", key: "limiteCredito", format: "currency" },
      { header: "Saldo pendiente", key: "saldoPendiente", format: "currency" },
    ],
    rows,
    { title: `Clientes — ${COMPANY}` }
  );
  sendXlsx(res, "clientes.xlsx", buffer);
});
