import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { getStockByCategory } from "../services/stockService";
import { ROLL_CODE_PREFIX, type OpStation } from "../services/opTemplates";
import { buildExcelBuffer, humanize } from "../services/exportExcel";

export const exportRouter = Router();
exportRouter.use(requireAuth);

const COMPANY = "Plásticos Superior S.A.S.";

/**
 * Filtro opcional por fecha (?desde=AAAA-MM-DD&hasta=AAAA-MM-DD), en hora de
 * Colombia: "hasta" incluye el día completo. Sin fechas, exporta todo.
 */
type DateRange = { gte?: Date; lt?: Date };
function parseDateRange(query: Record<string, unknown>): { range: DateRange; label: string } | { error: string } {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const desde = typeof query.desde === "string" && query.desde ? query.desde : null;
  const hasta = typeof query.hasta === "string" && query.hasta ? query.hasta : null;
  if ((desde && !day.test(desde)) || (hasta && !day.test(hasta))) return { error: "Fecha inválida (usá AAAA-MM-DD)" };
  const range: DateRange = {};
  if (desde) range.gte = new Date(`${desde}T00:00:00-05:00`);
  if (hasta) range.lt = new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 24 * 60 * 60 * 1000);
  if ((range.gte && isNaN(range.gte.getTime())) || (range.lt && isNaN(range.lt.getTime()))) return { error: "Fecha inválida (usá AAAA-MM-DD)" };
  if (range.gte && range.lt && range.gte >= range.lt) return { error: "La fecha 'desde' es posterior a 'hasta'" };
  const label = desde || hasta ? ` (${desde ?? "inicio"} a ${hasta ?? "hoy"})` : "";
  return { range, label };
}

function rangeWhere(range: DateRange) {
  return range.gte || range.lt ? range : undefined;
}

const userName = (u: { name: string } | null | undefined) => u?.name ?? "";
const rollCode = (r: { station: string; stationSequence: number }) => `${ROLL_CODE_PREFIX[r.station as OpStation]}-${r.stationSequence}`;
const warehouse = (w: string) => (w === "principal" ? "Bodega principal" : humanize(w));

function sendXlsx(res: import("express").Response, filename: string, buffer: Buffer) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

/** Mismo guard que GET /inventory (ROLES.EXISTENCIAS) — a pedido del
 * cliente, Gerente de Producción y los operarios de planta no ven cuánto
 * stock hay (ver comentario en middleware/auth.ts). Este export se había
 * quedado con el comentario viejo ("cualquier autenticado") de antes de que
 * ese guard existiera en /inventory — el export nunca se actualizó junto
 * con la ruta. */
exportRouter.get("/inventario", requireRole(...ROLES.EXISTENCIAS), async (_req, res) => {
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

exportRouter.get("/pedidos", requireVentas, async (req, res) => {
  const dates = parseDateRange(req.query);
  if ("error" in dates) return res.status(400).json({ error: dates.error });
  const pedidos = await prisma.pedido.findMany({
    where: { createdAt: rangeWhere(dates.range) },
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
    { title: `Pedidos${dates.label} — ${COMPANY}` }
  );
  sendXlsx(res, "pedidos.xlsx", buffer);
});

exportRouter.get("/facturas", requireVentas, async (req, res) => {
  const dates = parseDateRange(req.query);
  if ("error" in dates) return res.status(400).json({ error: dates.error });
  const facturas = await prisma.factura.findMany({
    where: { createdAt: rangeWhere(dates.range) },
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
    { title: `Facturas${dates.label} — ${COMPANY}` }
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

// --- Producción --------------------------------------------------------

const requireProduccion = requireRole(...ROLES.PRODUCCION_GESTION);

/** Órdenes de producción (creadas en el rango): estación, estado, cliente y
 * lo producido (kilos y cantidad de rollos registrados en esa OP). */
exportRouter.get("/ordenes-produccion", requireProduccion, async (req, res) => {
  const dates = parseDateRange(req.query);
  if ("error" in dates) return res.status(400).json({ error: dates.error });
  const orders = await prisma.productionOrder.findMany({
    where: { createdAt: rangeWhere(dates.range) },
    include: {
      product: { select: { sku: true, name: true } },
      client: { select: { name: true } },
      parent: { select: { orderNumber: true } },
      createdBy: { select: { name: true } },
      rolls: { select: { weightKg: true, wasteKg: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = orders.map((o) => ({
    orderNumber: o.orderNumber,
    estacion: o.station ? humanize(o.station) : "Sin estación",
    estado: humanize(o.status),
    sku: o.product.sku,
    producto: o.product.name,
    cliente: o.client?.name ?? "Inventario general",
    medida: o.measure ?? "",
    planeado: Number(o.quantityPlanned),
    producidoKg: Math.round(o.rolls.reduce((acc, r) => acc + Number(r.weightKg), 0) * 100) / 100,
    mermaKg: Math.round(o.rolls.reduce((acc, r) => acc + Number(r.wasteKg), 0) * 100) / 100,
    rollos: o.rolls.length,
    opPadre: o.parent?.orderNumber ?? "",
    creadaPor: userName(o.createdBy),
    fecha: o.createdAt,
  }));
  const buffer = await buildExcelBuffer(
    "OPs",
    [
      { header: "OP", key: "orderNumber" },
      { header: "Estación", key: "estacion" },
      { header: "Estado", key: "estado" },
      { header: "SKU", key: "sku" },
      { header: "Producto", key: "producto", width: 30 },
      { header: "Cliente", key: "cliente", width: 26 },
      { header: "Medida", key: "medida" },
      { header: "Cantidad planeada", key: "planeado", format: "number" },
      { header: "Producido (kg)", key: "producidoKg", format: "number" },
      { header: "Merma (kg)", key: "mermaKg", format: "number" },
      { header: "Rollos", key: "rollos", format: "number" },
      { header: "OP padre", key: "opPadre" },
      { header: "Creada por", key: "creadaPor", width: 20 },
      { header: "Fecha", key: "fecha", format: "date" },
    ],
    rows,
    { title: `Órdenes de producción${dates.label} — ${COMPANY}` }
  );
  sendXlsx(res, "ordenes-produccion.xlsx", buffer);
});

/** Rollos registrados en el rango, con su OP, operario y pesos. */
exportRouter.get("/rollos", requireProduccion, async (req, res) => {
  const dates = parseDateRange(req.query);
  if ("error" in dates) return res.status(400).json({ error: dates.error });
  const rolls = await prisma.productionRoll.findMany({
    where: { createdAt: rangeWhere(dates.range) },
    include: {
      productionOrder: { select: { orderNumber: true, product: { select: { name: true } }, client: { select: { name: true } } } },
      sourceRoll: { select: { station: true, stationSequence: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = rolls.map((r) => ({
    codigo: rollCode(r),
    etiqueta: r.label ?? "",
    op: r.productionOrder.orderNumber,
    estacion: humanize(r.station),
    producto: r.productionOrder.product.name,
    cliente: r.productionOrder.client?.name ?? "Inventario general",
    operario: r.operatorName,
    turno: r.shift ?? "",
    maquina: r.machine ?? "",
    pesoKg: Number(r.weightKg),
    mermaKg: Number(r.wasteKg),
    rolloOrigen: r.sourceRoll ? rollCode(r.sourceRoll) : "",
    fecha: r.createdAt,
  }));
  const buffer = await buildExcelBuffer(
    "Rollos",
    [
      { header: "Código", key: "codigo" },
      { header: "Etiqueta", key: "etiqueta" },
      { header: "OP", key: "op" },
      { header: "Estación", key: "estacion" },
      { header: "Producto", key: "producto", width: 30 },
      { header: "Cliente", key: "cliente", width: 26 },
      { header: "Operario", key: "operario", width: 20 },
      { header: "Turno", key: "turno" },
      { header: "Máquina", key: "maquina" },
      { header: "Peso (kg)", key: "pesoKg", format: "number" },
      { header: "Merma (kg)", key: "mermaKg", format: "number" },
      { header: "Rollo de origen", key: "rolloOrigen" },
      { header: "Fecha", key: "fecha", format: "date" },
    ],
    rows,
    { title: `Rollos${dates.label} — ${COMPANY}` }
  );
  sendXlsx(res, "rollos.xlsx", buffer);
});

/** Despachos a bodegas (traslados de rollos entre estaciones) del rango. */
exportRouter.get("/despachos-bodegas", requireProduccion, async (req, res) => {
  const dates = parseDateRange(req.query);
  if ("error" in dates) return res.status(400).json({ error: dates.error });
  const transfers = await prisma.rollTransfer.findMany({
    where: { createdAt: rangeWhere(dates.range) },
    include: {
      roll: { select: { station: true, stationSequence: true, productionOrder: { select: { orderNumber: true } } } },
      registeredBy: { select: { name: true } },
      receivedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const rows = transfers.map((t) => ({
    rollo: rollCode(t.roll),
    op: t.roll.productionOrder.orderNumber,
    desde: warehouse(t.fromStation),
    hacia: warehouse(t.toStation),
    modo: humanize(t.mode),
    lleva: t.carrierName,
    enviadoKg: t.dispatchedKg == null ? null : Number(t.dispatchedKg),
    estado: t.status === "recibido" ? "Recibido" : "En tránsito",
    recibidoKg: t.receivedKg == null ? null : Number(t.receivedKg),
    registro: userName(t.registeredBy),
    recibio: userName(t.receivedBy),
    salida: t.createdAt,
    recepcion: t.receivedAt,
  }));
  const buffer = await buildExcelBuffer(
    "Despachos a bodegas",
    [
      { header: "Rollo", key: "rollo" },
      { header: "OP", key: "op" },
      { header: "Desde", key: "desde" },
      { header: "Hacia", key: "hacia" },
      { header: "Modo", key: "modo" },
      { header: "Lo lleva", key: "lleva", width: 20 },
      { header: "Enviado (kg)", key: "enviadoKg", format: "number" },
      { header: "Estado", key: "estado" },
      { header: "Recibido (kg)", key: "recibidoKg", format: "number" },
      { header: "Registró", key: "registro", width: 20 },
      { header: "Recibió", key: "recibio", width: 20 },
      { header: "Salida", key: "salida", format: "date" },
      { header: "Recepción", key: "recepcion", format: "date" },
    ],
    rows,
    { title: `Despachos a bodegas${dates.label} — ${COMPANY}` }
  );
  sendXlsx(res, "despachos-bodegas.xlsx", buffer);
});

/** Movimientos de materia prima (compras, consumo en producción, ajustes). */
exportRouter.get("/materia-prima", requireProduccion, async (req, res) => {
  const dates = parseDateRange(req.query);
  if ("error" in dates) return res.status(400).json({ error: dates.error });
  const movements = await prisma.rawMaterialMovement.findMany({
    where: { createdAt: rangeWhere(dates.range) },
    include: { rawMaterial: { select: { code: true, name: true } }, createdBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const rows = movements.map((m) => ({
    codigo: m.rawMaterial.code,
    nombre: m.rawMaterial.name ?? "",
    tipo: humanize(m.movementType),
    cantidad: Number(m.quantity),
    notas: m.notes ?? "",
    usuario: userName(m.createdBy),
    fecha: m.createdAt,
  }));
  const buffer = await buildExcelBuffer(
    "Materia prima",
    [
      { header: "Código", key: "codigo" },
      { header: "Materia prima", key: "nombre", width: 26 },
      { header: "Movimiento", key: "tipo" },
      { header: "Cantidad (kg)", key: "cantidad", format: "number" },
      { header: "Notas", key: "notas", width: 30 },
      { header: "Usuario", key: "usuario", width: 20 },
      { header: "Fecha", key: "fecha", format: "date" },
    ],
    rows,
    { title: `Movimientos de materia prima${dates.label} — ${COMPANY}` }
  );
  sendXlsx(res, "materia-prima.xlsx", buffer);
});

/** Movimientos de inventario de producto terminado (entradas, despachos,
 * ajustes y devoluciones). Mismo guard que Existencias. */
exportRouter.get("/movimientos", requireRole(...ROLES.EXISTENCIAS), async (req, res) => {
  const dates = parseDateRange(req.query);
  if ("error" in dates) return res.status(400).json({ error: dates.error });
  const movements = await prisma.inventoryMovement.findMany({
    where: { createdAt: rangeWhere(dates.range) },
    include: { product: { select: { sku: true, name: true, unit: true } }, createdBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  const rows = movements.map((m) => ({
    sku: m.product.sku,
    producto: m.product.name,
    tipo: humanize(m.movementType),
    cantidad: Number(m.quantity),
    unidad: m.product.unit,
    origen: humanize(m.referenceType),
    notas: m.notes ?? "",
    usuario: userName(m.createdBy),
    fecha: m.createdAt,
  }));
  const buffer = await buildExcelBuffer(
    "Movimientos",
    [
      { header: "SKU", key: "sku" },
      { header: "Producto", key: "producto", width: 30 },
      { header: "Movimiento", key: "tipo" },
      { header: "Cantidad", key: "cantidad", format: "number" },
      { header: "Unidad", key: "unidad" },
      { header: "Origen", key: "origen" },
      { header: "Notas", key: "notas", width: 30 },
      { header: "Usuario", key: "usuario", width: 20 },
      { header: "Fecha", key: "fecha", format: "date" },
    ],
    rows,
    { title: `Movimientos de inventario${dates.label} — ${COMPANY}` }
  );
  sendXlsx(res, "movimientos.xlsx", buffer);
});
