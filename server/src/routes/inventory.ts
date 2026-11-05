import { Router } from "express";
import { prisma } from "../prisma";
import { requireAuth, requireRole, ROLES } from "../middleware/auth";
import { z } from "zod";
import { applyMovement, getLowStockAlerts, getStockByCategory, InsufficientStockError } from "../services/stockService";
import { reservedByProduct } from "../services/reservations";
import { clientReservations } from "../services/reservations";
import { extrusionRollsInventory } from "../services/extrusionRolls";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

const requireInventario = requireRole(...ROLES.INVENTARIO);
const requireExistencias = requireRole(...ROLES.EXISTENCIAS);

inventoryRouter.get("/", requireExistencias, async (req, res) => {
  const stock = await getStockByCategory();
  const category = req.query.category as string | undefined;
  res.json(category ? stock.filter((p) => p.category === category) : stock);
});

/** "Rollos para clientes": lo fabricado para cada cliente que todavía no se
 * le despachó (ver services/reservations.ts). */
inventoryRouter.get("/client-reservations", requireExistencias, async (_req, res) => {
  res.json(await clientReservations());
});

/** Rollos de Extrusión con material sin consumir, por producto: cuántos hay y
 * cuántos kilos, general vs. de cada cliente (ver services/extrusionRolls.ts). */
inventoryRouter.get("/extrusion-rolls", requireExistencias, async (_req, res) => {
  res.json(await extrusionRollsInventory());
});

inventoryRouter.get("/alerts", requireExistencias, async (_req, res) => {
  res.json(await getLowStockAlerts());
});

inventoryRouter.get("/products", requireInventario, async (_req, res) => {
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  res.json(products);
});

/** Historial de movimientos de stock (log operativo de bodega) — más
 * restringido que "Existencias", que también consultan Ventas/Planeación. */
inventoryRouter.get("/movements", requireRole(...ROLES.ALMACEN), async (req, res) => {
  let productId: number | undefined;
  if (req.query.productId !== undefined) {
    productId = Number(req.query.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: "productId inválido" });
    }
  }

  const MOVEMENT_TYPES = ["entrada_produccion", "salida_despacho", "ajuste", "devolucion"];
  const movementType = req.query.movementType as string | undefined;
  if (movementType !== undefined && !MOVEMENT_TYPES.includes(movementType)) {
    return res.status(400).json({ error: "movementType inválido" });
  }

  let page = 1;
  if (req.query.page !== undefined) {
    page = Number(req.query.page);
    if (!Number.isInteger(page) || page < 1) return res.status(400).json({ error: "page inválido" });
  }

  let pageSize = 50;
  if (req.query.pageSize !== undefined) {
    pageSize = Number(req.query.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1) return res.status(400).json({ error: "pageSize inválido" });
    pageSize = Math.min(200, pageSize);
  }

  const where = { productId, movementType: movementType as any };

  const [items, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      include: {
        product: { select: { sku: true, name: true, unit: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  // De dónde salió cada movimiento, en palabras (la referencia es
  // polimórfica: referenceType + referenceId, sin FK). Antes la pantalla solo
  // mostraba el tipo, y una entrada por Calidad aparecía como "ajuste manual"
  // sin forma de saber de qué OP venía.
  const idsOf = (type: string) => [...new Set(items.filter((m) => m.referenceType === type && m.referenceId != null).map((m) => m.referenceId!))];
  const [orders, dispatchItems] = await Promise.all([
    prisma.productionOrder.findMany({ where: { id: { in: idsOf("production_order") } }, select: { id: true, orderNumber: true, station: true } }),
    prisma.dispatchItem.findMany({
      where: { id: { in: idsOf("dispatch_item") } },
      select: { id: true, dispatchId: true, dispatch: { select: { client: { select: { name: true } } } } },
    }),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  // Almacén ve Movimientos pero no puede abrir la hoja de una OP (el router
  // de production-orders no lo admite): para ese rol el origen va sin link,
  // en vez de un link que lo rebota al inicio.
  const canOpenOrders = ([...ROLES.OPERARIOS, ...ROLES.CALIDAD, ...ROLES.AUDITORIA] as string[]).includes(req.user!.role);
  const dispatchItemById = new Map(dispatchItems.map((d) => [d.id, d]));
  const originOf = (m: (typeof items)[number]): { label: string; link?: string } => {
    if (m.referenceType === "production_order") {
      const o = m.referenceId != null ? orderById.get(m.referenceId) : undefined;
      if (!o) return { label: "OP (ya no existe)" };
      const verb = m.movementType === "entrada_produccion" ? "Aprobada en Calidad" : "Reversión por reapertura";
      return { label: `${verb} · ${o.orderNumber}`, link: canOpenOrders ? `/produccion/ordenes/${o.id}` : undefined };
    }
    if (m.referenceType === "dispatch_item") {
      const d = m.referenceId != null ? dispatchItemById.get(m.referenceId) : undefined;
      return d ? { label: `Despacho #${d.dispatchId} · ${d.dispatch.client.name}`, link: "/despachos" } : { label: "Despacho" };
    }
    if (m.referenceType === "production_entry") return { label: "Carga de producción", link: "/produccion" };
    return { label: m.notes ? `Ajuste manual · ${m.notes}` : "Ajuste manual" };
  };

  res.json({ items: items.map((m) => ({ ...m, origin: originOf(m) })), total, page, pageSize });
});

const countSchema = z.object({
  /** Lo que se contó/pesó físicamente del producto (en su unidad). */
  countedQuantity: z.number().min(0).max(10_000_000),
  notes: z.string().trim().min(3, "Escribí el motivo del ajuste (ej. conteo físico mensual)").max(500),
});

/**
 * Ajuste por conteo físico de un producto terminado (Almacén): el stock pasa
 * a ser lo contado, con un movimiento "ajuste" por la diferencia y el motivo
 * (se ve en Movimientos). Si el producto tiene stock ubicado en estantes y
 * el conteo queda por debajo de lo ubicado, hay que corregir primero los
 * estantes en Almacén/WMS. Avisa si lo contado queda por debajo de lo
 * reservado para clientes.
 */
inventoryRouter.post("/:productId/count", requireRole(...ROLES.ALMACEN), async (req, res) => {
  const productId = Number(req.params.productId);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: "Id inválido" });
  const parsed = countSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, unit: true } });
  if (!product) return res.status(404).json({ error: "Producto no encontrado" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Misma fila que bloquean los despachos: nadie mueve el stock entre la
      // lectura y el ajuste.
      await tx.$queryRaw`SELECT product_id FROM inventory_stock WHERE product_id = ${productId} FOR UPDATE`;
      const stock = await tx.inventoryStock.findUnique({ where: { productId }, select: { currentQuantity: true } });
      const previous = Number(stock?.currentQuantity ?? 0);
      const counted = Math.round(parsed.data.countedQuantity * 100) / 100;
      const delta = Math.round((counted - previous) * 100) / 100;
      if (delta !== 0) {
        await applyMovement(tx, {
          productId,
          quantity: delta,
          movementType: "ajuste",
          referenceType: "manual_adjustment",
          createdById: req.user!.userId,
          notes: `Conteo físico: ${parsed.data.notes}`,
        });
      }
      const reserved = (await reservedByProduct(tx, { productIds: [productId] })).get(productId) ?? 0;
      return { previous, counted, delta, reserved };
    });
    res.status(201).json({
      productId,
      previousQuantity: result.previous,
      newQuantity: result.counted,
      delta: result.delta,
      unit: product.unit,
      // Lo contado no alcanza para lo que está reservado para clientes.
      belowReserved: result.counted < result.reserved - 0.005 ? result.reserved : null,
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

