import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";

type TxClient = Prisma.TransactionClient;

/**
 * Registra un movimiento de inventario y recalcula el stock desnormalizado
 * del producto dentro de la misma transacción, para que ambas tablas
 * nunca queden inconsistentes entre sí.
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
  }
) {
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

  await tx.inventoryStock.upsert({
    where: { productId: params.productId },
    create: { productId: params.productId, currentQuantity: params.quantity },
    update: { currentQuantity: { increment: params.quantity } },
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
      belowMinimum: currentStock < minStock,
    };
  });
}

export async function getLowStockAlerts() {
  const stock = await getStockByCategory();
  return stock.filter((p) => p.belowMinimum);
}
