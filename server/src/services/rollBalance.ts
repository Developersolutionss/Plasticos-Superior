import { prisma } from "../prisma";
import type { TxClient } from "./stockService";

/** Se pidió sacar más kilos de los que quedaban entre todos los rollos madre
 * escaneados — el operario tiene que escanear el siguiente para cubrir el
 * faltante (ver POST /production-orders/:id/rolls). */
export class InsufficientSourceRollError extends Error {
  constructor(public readonly missingKg: number) {
    super(`Faltan ${missingKg} kg`);
  }
}

/**
 * Kilos que todavía quedan sin consumir de un rollo madre: su peso menos
 * todo lo que ya se le sacó. Es la cuenta que los operarios venían haciendo
 * a mano en el papel (45 − 15 − 10 − 10 = 10).
 */
export async function remainingSourceKg(tx: TxClient | typeof prisma, sourceRollId: number): Promise<number> {
  const [roll, consumed] = await Promise.all([
    tx.productionRoll.findUnique({ where: { id: sourceRollId }, select: { weightKg: true } }),
    tx.rollConsumption.aggregate({ _sum: { quantityKg: true }, where: { sourceRollId } }),
  ]);
  if (!roll) return 0;
  const remaining = Number(roll.weightKg) - Number(consumed._sum.quantityKg ?? 0);
  // Redondeo a 2 decimales: los pesos son Decimal(12,2), pero restar varios
  // seguidos en punto flotante deja restos tipo 9.999999999999998.
  return Math.round(Math.max(remaining, 0) * 100) / 100;
}

/** Se escaneó como insumo un rollo que ya no tiene saldo (Extrusión/
 * Impresión, donde el insumo se consume entero de una vez). */
export class SourceRollExhaustedError extends Error {}

export interface Allocation {
  sourceRollId: number;
  quantityKg: number;
}

/** Bloquea los rollos madre antes de leer sus saldos — dos filas cargadas a
 * la vez contra el mismo rollo leerían el mismo saldo viejo y lo dejarían
 * sobregirado (mismo patrón que el lock del despacho en dispatches.ts). */
async function lockSourceRolls(tx: TxClient, sourceRollIds: number[]) {
  await tx.$queryRaw`SELECT id FROM production_rolls WHERE id = ANY(${sourceRollIds}::int[]) FOR UPDATE`;
}

/**
 * Consume ENTERO cada rollo escaneado (el comportamiento de siempre en
 * Impresión): se le saca todo el saldo que le quede. Si ya está en cero es
 * que alguien lo consumió antes — hasta ahora eso lo frenaba un unique en
 * `source_roll_id`, que dejó de existir al permitir consumo parcial.
 */
export async function allocateWholeSourceRolls(tx: TxClient, sourceRollIds: number[]): Promise<Allocation[]> {
  if (sourceRollIds.length === 0) return [];
  await lockSourceRolls(tx, sourceRollIds);

  const allocations: Allocation[] = [];
  for (const sourceRollId of sourceRollIds) {
    const available = await remainingSourceKg(tx, sourceRollId);
    if (available <= 0) throw new SourceRollExhaustedError();
    allocations.push({ sourceRollId, quantityKg: available });
  }
  return allocations;
}

/**
 * Reparte los kilos de un rollo chico entre los rollos madre escaneados, en
 * el orden en que se escanearon: se agota el primero antes de tocar el
 * segundo. Si al operario le quedaban 10 kg del madre A y carga un rollo de
 * 15, salen 10 de A (que queda en 0) y 5 de B — tal cual lo hacen en planta.
 *
 * Los rollos madre se bloquean con SELECT ... FOR UPDATE antes de leer sus
 * saldos: sin eso, dos operarios cargando contra el mismo rollo al mismo
 * tiempo leen los dos el mismo saldo viejo y lo dejan sobregirado.
 */
export async function allocateFromSourceRolls(
  tx: TxClient,
  sourceRollIds: number[],
  quantityKg: number
): Promise<Allocation[]> {
  if (sourceRollIds.length === 0) return [];
  await lockSourceRolls(tx, sourceRollIds);

  const allocations: Allocation[] = [];
  let pending = Math.round(quantityKg * 100) / 100;

  for (const sourceRollId of sourceRollIds) {
    if (pending <= 0) break;
    const available = await remainingSourceKg(tx, sourceRollId);
    if (available <= 0) continue;
    const take = Math.round(Math.min(available, pending) * 100) / 100;
    allocations.push({ sourceRollId, quantityKg: take });
    pending = Math.round((pending - take) * 100) / 100;
  }

  // Tolerancia de medio gramo: sumar y restar decimales deja restos que no
  // son un faltante real (ej. 0.0000000001 kg).
  if (pending > 0.005) throw new InsufficientSourceRollError(pending);

  return allocations;
}
