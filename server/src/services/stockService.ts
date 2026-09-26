import { prisma } from "../prisma";
import { ROLES } from "../middleware/auth";
import { notifyRolesTx } from "./notify";

// `prisma` está envuelto en `$extends` (auditExtension.ts), así que el tipo
// del cliente de transacción ya no es el `Prisma.TransactionClient` genérico
// — se deriva del propio `$transaction` extendido para que sea compatible.
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Se pidió sacar más stock del que hay disponible (producto o ubicación) —
 * `applyMovement`/`decrementLocationStock` nunca dejan una cantidad en
 * negativo, la rechazan siempre (ver auditoría del sistema de inventario). */
export class InsufficientStockError extends Error {}

/**
 * Registra un movimiento de inventario y recalcula el stock desnormalizado
 * del producto dentro de la misma transacción, para que ambas tablas
 * nunca queden inconsistentes entre sí. Una salida (`quantity` negativo)
 * nunca deja el stock en negativo: el chequeo de saldo y el descuento son
 * UN SOLO `UPDATE` condicional atómico (no un find-then-check), para que
 * dos salidas casi simultáneas no puedan las dos pasar el chequeo leyendo
 * el mismo saldo viejo y dejar el producto doblemente descontado.
 */
export async function applyMovement(
  tx: TxClient,
  params: {
    productId: number;
    quantity: number; // positivo = entrada, negativo = salida
    movementType: "entrada_produccion" | "salida_despacho" | "ajuste" | "devolucion";
    referenceType: "production_entry" | "dispatch_item" | "manual_adjustment" | "production_order";
    referenceId?: number;
    productionEntryId?: number;
    createdById?: number;
    /** Ubicación física de la que sale (o a la que entra) el stock — ver
     * `decrementLocationStock`/`incrementLocationStock`. Opcional: si no se
     * manda, el movimiento solo toca el total agregado, igual que antes. */
    locationId?: number;
  }
) {
  if (params.quantity < 0) {
    const claim = await tx.inventoryStock.updateMany({
      where: { productId: params.productId, currentQuantity: { gte: -params.quantity } },
      data: { currentQuantity: { increment: params.quantity } },
    });
    if (claim.count === 0) {
      const [current, product] = await Promise.all([
        tx.inventoryStock.findUnique({ where: { productId: params.productId } }),
        tx.product.findUnique({ where: { id: params.productId }, select: { sku: true, name: true, unit: true } }),
      ]);
      throw new InsufficientStockError(
        `Stock insuficiente de ${product ? `${product.name} (${product.sku})` : "este producto"}: hay ${Number(current?.currentQuantity ?? 0)} ${product?.unit ?? ""} disponibles, se pidieron ${-params.quantity}`.replace(/  +/g, " ")
      );
    }
    if (params.locationId != null) {
      await decrementLocationStock(tx, params.productId, params.locationId, -params.quantity, params.createdById);
    } else {
      // Una salida sin ubicación solo puede salir de lo que está "sin
      // ubicar" (total menos lo asignado a estantes). Si no, el total baja
      // pero los estantes siguen mostrando lo mismo, y el almacén termina
      // diciendo que hay más producto ubicado que el que existe. El
      // formulario de Despachos ya obliga a elegir estante; esto lo hace
      // valer para cualquier camino (reabrir una OP aprobada, anular un
      // despacho, API directa).
      await assertUnlocatedCovers(tx, params.productId);
    }
    await notifyIfCrossedMinimum(tx, params.productId, -params.quantity);
  } else {
    // La primera entrada de un producto que todavía no tiene fila en
    // inventory_stock la crea. Prisma compila este `upsert` (where por
    // unique simple, sin nested writes) a un `INSERT ... ON CONFLICT DO
    // UPDATE` nativo de Postgres — un solo statement atómico — así que dos
    // entradas casi simultáneas del mismo producto nuevo no pueden chocar
    // entre sí (y un catch-and-retry acá no serviría de nada: adentro de
    // esta misma transacción, si un statement fallara, Postgres la deja
    // abortada y el siguiente statement fallaría también).
    await tx.inventoryStock.upsert({
      where: { productId: params.productId },
      create: { productId: params.productId, currentQuantity: params.quantity },
      update: { currentQuantity: { increment: params.quantity } },
    });
    if (params.locationId != null) {
      await incrementLocationStock(tx, params.productId, params.locationId, params.quantity, params.createdById);
    }
  }

  await tx.inventoryMovement.create({
    data: {
      productId: params.productId,
      quantity: params.quantity,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      productionEntryId: params.productionEntryId,
      createdById: params.createdById,
    },
  });
}

/** Ya descontado el total: si lo ubicado en estantes quedó por encima del
 * total, la salida sin ubicación se comió stock que estaba en un estante —
 * se rechaza (la transacción entera se deshace). */
async function assertUnlocatedCovers(tx: TxClient, productId: number) {
  const [stock, located] = await Promise.all([
    tx.inventoryStock.findUnique({ where: { productId }, select: { currentQuantity: true } }),
    tx.stockLocation.aggregate({ where: { productId }, _sum: { quantity: true } }),
  ]);
  const total = Number(stock?.currentQuantity ?? 0);
  const ubicado = Number(located._sum.quantity ?? 0);
  if (ubicado > total + 0.005) {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { sku: true, name: true } });
    throw new InsufficientStockError(
      `${product ? `${product.name} (${product.sku})` : "Este producto"} tiene stock ubicado en estantes — elegí de qué ubicación sale (lo que queda sin ubicar no alcanza)`
    );
  }
}

/** Aviso a Almacén y Gestión cuando una salida deja el producto por debajo de
 * su stock mínimo. Solo al CRUZAR el mínimo (antes estaba en o sobre el
 * mínimo, ahora debajo), no en cada salida posterior — si no, cada despacho
 * de un producto ya bajo mínimo repetiría el aviso. */
async function notifyIfCrossedMinimum(tx: TxClient, productId: number, salida: number) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { sku: true, name: true, unit: true, minStock: true, active: true, stock: { select: { currentQuantity: true } } },
  });
  if (!product || !product.active) return;
  const min = Number(product.minStock);
  const despues = Number(product.stock?.currentQuantity ?? 0);
  const antes = despues + salida;
  if (min > 0 && antes >= min && despues < min) {
    await notifyRolesTx(tx, [...new Set([...ROLES.ALMACEN, ...ROLES.PRODUCCION_GESTION])], {
      type: "stock_bajo_minimo",
      message: `${product.name} (${product.sku}) quedó bajo el mínimo: ${despues} ${product.unit} (mínimo ${min})`,
      link: "/",
    });
  }
}

/** Descuenta stock de una ubicación física puntual, atómico y sin dejarla
 * en negativo — mismo patrón de `UPDATE` condicional que `applyMovement`. */
export async function decrementLocationStock(tx: TxClient, productId: number, locationId: number, quantity: number, updatedById?: number) {
  const claim = await tx.stockLocation.updateMany({
    where: { productId, locationId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity }, updatedById },
  });
  if (claim.count === 0) {
    const [product, location, row] = await Promise.all([
      tx.product.findUnique({ where: { id: productId }, select: { sku: true, name: true } }),
      tx.warehouseLocation.findUnique({ where: { id: locationId }, select: { code: true } }),
      tx.stockLocation.findUnique({ where: { productId_locationId: { productId, locationId } }, select: { quantity: true } }),
    ]);
    throw new InsufficientStockError(
      `La ubicación ${location?.code ?? ""} no tiene suficiente ${product ? `${product.name} (${product.sku})` : "de este producto"}: hay ${Number(row?.quantity ?? 0)}, se pidieron ${quantity}`.replace(/  +/g, " ")
    );
  }
}

/** Suma stock a una ubicación física puntual (crea la fila si no existía) —
 * mismo `upsert` atómico nativo que la rama de entrada de `applyMovement`. */
export async function incrementLocationStock(tx: TxClient, productId: number, locationId: number, quantity: number, updatedById?: number) {
  await tx.stockLocation.upsert({
    where: { productId_locationId: { productId, locationId } },
    create: { productId, locationId, quantity, updatedById },
    update: { quantity: { increment: quantity }, updatedById },
  });
}

export async function getStockByCategory() {
  const products = await prisma.product.findMany({
    include: { stock: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return products.map((p) => {
    const currentStock = Number(p.stock?.currentQuantity ?? 0);
    const minStock = Number(p.minStock);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      measure: p.measure,
      unit: p.unit,
      minStock,
      currentStock,
      active: p.active,
      belowMinimum: currentStock < minStock,
    };
  });
}

export async function getLowStockAlerts() {
  const stock = await getStockByCategory();
  // Un producto desactivado (descontinuado) se queda para siempre en las
  // alertas si no se filtra acá -- mismo criterio que ya tenía
  // getRawMaterialLowStockAlerts (rawMaterialStockService.ts), a este le
  // faltaba. getStockByCategory en sí NO filtra por `active` (Existencias,
  // el export y /warehouse/stock siguen mostrando el catálogo completo,
  // incluidos los descontinuados) — el filtro es solo para la alerta.
  return stock.filter((p) => p.active && p.belowMinimum);
}
