import { prisma } from "../prisma";
import type { TxClient } from "./stockService";
import { InsufficientStockError } from "./stockService";
import { ROLES } from "../middleware/auth";
import { notifyRolesTx } from "./notify";

export { InsufficientStockError };

/**
 * Registra un movimiento de materia prima y recalcula el stock desnormalizado
 * dentro de la misma transacción — mismo patrón que applyMovement (stock de
 * productos terminados), para que insumos y producto nunca queden
 * inconsistentes con su bitácora de movimientos. Un consumo (`quantity`
 * negativo) nunca deja el insumo en negativo: mismo `UPDATE` condicional
 * atómico que applyMovement, no un find-then-check.
 */
export async function applyRawMaterialMovement(
  tx: TxClient,
  params: {
    rawMaterialId: number;
    quantity: number; // positivo = entrada (compra), negativo = salida (consumo)
    movementType: "compra" | "consumo_produccion" | "ajuste";
    referenceType?: "production_order" | "manual_adjustment";
    referenceId?: number;
    notes?: string;
    createdById?: number;
  }
) {
  if (params.quantity < 0) {
    const claim = await tx.rawMaterialStock.updateMany({
      where: { rawMaterialId: params.rawMaterialId, currentQuantity: { gte: -params.quantity } },
      data: { currentQuantity: { increment: params.quantity } },
    });
    if (claim.count === 0) {
      const [current, material] = await Promise.all([
        tx.rawMaterialStock.findUnique({ where: { rawMaterialId: params.rawMaterialId } }),
        tx.rawMaterial.findUnique({ where: { id: params.rawMaterialId }, select: { code: true } }),
      ]);
      // Nombra el insumo: antes el cierre de Extrusión decía solo "hay 64
      // disponibles, se pidieron 690" y no había forma de saber cuál de las
      // 10 materias primas era la que faltaba.
      throw new InsufficientStockError(
        `Stock insuficiente de materia prima ${material?.code ?? ""}: hay ${Number(current?.currentQuantity ?? 0)} kg disponibles, se pidieron ${-params.quantity} kg`.replace(/  +/g, " ")
      );
    }
    await notifyIfRawMaterialCrossedMinimum(tx, params.rawMaterialId, -params.quantity);
  } else {
    // Mismo `upsert` atómico nativo (INSERT ... ON CONFLICT DO UPDATE) que
    // la rama de entrada de applyMovement -- la primera entrada de un
    // insumo sin fila en raw_material_stock no puede chocar entre dos
    // entradas casi simultáneas.
    await tx.rawMaterialStock.upsert({
      where: { rawMaterialId: params.rawMaterialId },
      create: { rawMaterialId: params.rawMaterialId, currentQuantity: params.quantity },
      update: { currentQuantity: { increment: params.quantity } },
    });
  }

  await tx.rawMaterialMovement.create({
    data: {
      rawMaterialId: params.rawMaterialId,
      quantity: params.quantity,
      movementType: params.movementType,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      notes: params.notes,
      createdById: params.createdById,
    },
  });
}

/** Aviso a Gestión/Planeación cuando un consumo deja la materia prima por
 * debajo de su mínimo — es lo que después termina trabando el cierre de
 * Extrusión por falta de stock. Solo al CRUZAR el mínimo, no en cada
 * consumo posterior. */
async function notifyIfRawMaterialCrossedMinimum(tx: TxClient, rawMaterialId: number, salida: number) {
  const material = await tx.rawMaterial.findUnique({
    where: { id: rawMaterialId },
    select: { code: true, minStock: true, active: true, stock: { select: { currentQuantity: true } } },
  });
  if (!material || !material.active) return;
  const min = Number(material.minStock);
  const despues = Number(material.stock?.currentQuantity ?? 0);
  const antes = despues + salida;
  if (min > 0 && antes >= min && despues < min) {
    await notifyRolesTx(tx, ROLES.PRODUCCION_GESTION, {
      type: "materia_prima_bajo_minimo",
      message: `Materia prima ${material.code} quedó bajo el mínimo: ${despues} kg (mínimo ${min} kg)`,
      link: "/inventario/materia-prima",
    });
  }
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
