import { prisma } from "../prisma";
import type { TxClient } from "./stockService";

/**
 * Registra un movimiento de materia prima y recalcula el stock desnormalizado
 * dentro de la misma transacción — mismo patrón que applyMovement (stock de
 * productos terminados), para que insumos y producto nunca queden
 * inconsistentes con su bitácora de movimientos.
 */
export async function applyRawMaterialMovement(
  tx: TxClient,
  params: {
    rawMaterialId: number;
    quantity: number; // positivo = entrada (compra), negativo = salida (consumo)
    movementType: "compra" | "consumo_produccion" | "ajuste";
    referenceType?: "production_order" | "manual_adjustment";
    referenceId?: number;
    createdById?: number;
  }
) {
  await tx.rawMaterialMovement.create({
    data: {
      rawMaterialId: params.rawMaterialId,
      quantity: params.quantity,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      createdById: params.createdById,
    },
  });

  await tx.rawMaterialStock.upsert({
    where: { rawMaterialId: params.rawMaterialId },
    create: { rawMaterialId: params.rawMaterialId, currentQuantity: params.quantity },
    update: { currentQuantity: { increment: params.quantity } },
  });
}

export async function getRawMaterialStock() {
  const materials = await prisma.rawMaterial.findMany({
    include: { stock: true },
    orderBy: { code: "asc" },
  });

  return materials.map((m) => {
    const currentStock = Number(m.stock?.currentQuantity ?? 0);
    const minStock = Number(m.minStock);
    return {
      id: m.id,
      code: m.code,
      name: m.name,
      active: m.active,
      minStock,
      currentStock,
      belowMinimum: currentStock < minStock,
    };
  });
}

export async function getRawMaterialLowStockAlerts() {
  const stock = await getRawMaterialStock();
  return stock.filter((m) => m.active && m.belowMinimum);
}
