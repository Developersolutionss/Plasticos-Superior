import { prisma } from "../prisma";
import { Prisma } from "../generated/prisma/client";

// `prisma` está envuelto en `$extends` (auditExtension.ts), así que el tipo
// del cliente de transacción ya no es el `Prisma.TransactionClient` genérico
// — se deriva del propio `$transaction` extendido para que sea compatible.
export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** true si el error es un choque de unique constraint (P2002). */
export function isUniqueConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

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
    referenceType: "production_entry" | "dispatch_item" | "manual_adjustment";
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
      const current = await tx.inventoryStock.findUnique({ where: { productId: params.productId } });
      throw new InsufficientStockError(
        `Stock insuficiente: hay ${Number(current?.currentQuantity ?? 0)} disponibles, se pidieron ${-params.quantity}`
      );
    }
    if (params.locationId != null) {
      await decrementLocationStock(tx, params.productId, params.locationId, -params.quantity, params.createdById);
    }
  } else {
    // La primera entrada de un producto que todavía no tiene fila en
    // inventory_stock crea esa fila (`create`). Si dos entradas del mismo
    // producto nuevo llegan casi juntas, las dos pueden tomar la rama
    // `create` y la segunda choca contra la PK — se reintenta una vez como
    // `update` (la fila ya existe a esta altura) en vez de dejar
    // reventar un 500 crudo sin manejar.
    try {
      await tx.inventoryStock.upsert({
        where: { productId: params.productId },
        create: { productId: params.productId, currentQuantity: params.quantity },
        update: { currentQuantity: { increment: params.quantity } },
      });
    } catch (err) {
      if (!isUniqueConflict(err)) throw err;
      await tx.inventoryStock.update({
        where: { productId: params.productId },
        data: { currentQuantity: { increment: params.quantity } },
      });
    }
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

/** Descuenta stock de una ubicación física puntual, atómico y sin dejarla
 * en negativo — mismo patrón de `UPDATE` condicional que `applyMovement`. */
export async function decrementLocationStock(tx: TxClient, productId: number, locationId: number, quantity: number, updatedById?: number) {
  const claim = await tx.stockLocation.updateMany({
    where: { productId, locationId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity }, updatedById },
  });
  if (claim.count === 0) {
    throw new InsufficientStockError("La ubicación de origen no tiene suficiente cantidad de este producto");
  }
}

/** Suma stock a una ubicación física puntual (crea la fila si no existía). */
export async function incrementLocationStock(tx: TxClient, productId: number, locationId: number, quantity: number, updatedById?: number) {
  try {
    await tx.stockLocation.upsert({
      where: { productId_locationId: { productId, locationId } },
      create: { productId, locationId, quantity, updatedById },
      update: { quantity: { increment: quantity }, updatedById },
    });
  } catch (err) {
    if (!isUniqueConflict(err)) throw err;
    await tx.stockLocation.update({
      where: { productId_locationId: { productId, locationId } },
      data: { quantity: { increment: quantity }, updatedById },
    });
  }
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
