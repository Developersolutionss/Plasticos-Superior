import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import type { TxClient } from "./stockService";
import { ROLL_CODE_PREFIX, rollProducedKg, type OpStation } from "./opTemplates";
import { rollWhereFromCode } from "./rollCode";
import { verifyPossessionToken } from "./rollPossessionToken";

/**
 * Los rollos/bultos exactos que salen hacia un cliente (reunión con el
 * cliente, 2026-10-06): al despachar se escanea cada rollo, así lo que sale
 * queda atado a lo recién producido y Trazabilidad dice a qué cliente fue.
 *
 * - **Reserva de un cliente** (el despacho que generó Calidad desde su OP):
 *   los rollos que se pueden despachar son los de esa OP. Son obligatorios.
 * - **Despacho armado a mano:** opcionales; si se escanean, tienen que ser
 *   stock libre (rollos de OPs aprobadas sin cliente) o de una OP de ese
 *   mismo cliente — nunca de otro cliente.
 * - Un rollo sale una sola vez: los de un despacho cancelado quedan libres.
 */
export class DispatchRollError extends Error {}

export interface CandidateRoll {
  id: number;
  code: string;
  label: string | null;
  weightKg: number;
  orderNumber: string;
  /** "cliente": de la OP del cliente de este despacho; "stock": libre. */
  origin: "cliente" | "stock";
}

const rollCodeOf = (r: { station: string; stationSequence: number }) => `${ROLL_CODE_PREFIX[r.station as OpStation]}-${r.stationSequence}`;

const ROLL_SELECT = {
  id: true,
  station: true,
  stationSequence: true,
  label: true,
  weightKg: true,
  details: true,
  possessionTokenHash: true,
  productionOrder: { select: { id: true, orderNumber: true, clientId: true, productId: true, status: true, station: true } },
} as const;

/** Rollos que ya salieron en un despacho NO cancelado. */
async function alreadyDispatched(tx: TxClient | typeof prisma, rollIds: number[]): Promise<Set<number>> {
  if (!rollIds.length) return new Set();
  const rows = await tx.dispatchItemRoll.findMany({
    where: { rollId: { in: rollIds }, dispatchItem: { dispatch: { status: { not: "cancelada" } } } },
    select: { rollId: true },
  });
  return new Set(rows.map((r) => r.rollId));
}

/**
 * Qué rollos se pueden despachar en este ítem (los que el operario ve para
 * escanear). Reserva: los de su OP. Manual: stock libre del producto + los
 * de OPs de ese mismo cliente.
 */
export async function candidateRolls(dispatchId: number, productId: number): Promise<{ reserved: boolean; rolls: CandidateRoll[] }> {
  const dispatch = await prisma.dispatch.findUniqueOrThrow({ where: { id: dispatchId }, select: { clientId: true, productionOrderId: true } });
  const reserved = dispatch.productionOrderId != null;
  const rolls = await prisma.productionRoll.findMany({
    where: reserved
      ? { productionOrderId: dispatch.productionOrderId! }
      : {
          station: { in: ["sellado", "precorte"] },
          productionOrder: {
            productId,
            status: "finalizada",
            qualityCheck: { is: { result: "aprobado" } },
            OR: [{ clientId: null }, { clientId: dispatch.clientId }],
          },
        },
    select: ROLL_SELECT,
    orderBy: [{ productionOrderId: "asc" }, { stationSequence: "asc" }],
  });
  const taken = await alreadyDispatched(prisma, rolls.map((r) => r.id));
  return {
    reserved,
    rolls: rolls
      .filter((r) => !taken.has(r.id))
      .map((r) => ({
        id: r.id,
        code: rollCodeOf(r),
        label: r.label,
        weightKg: Math.round(rollProducedKg(r.station as OpStation, r) * 100) / 100,
        orderNumber: r.productionOrder.orderNumber,
        origin: r.productionOrder.clientId == null ? ("stock" as const) : ("cliente" as const),
      })),
  };
}

/**
 * Valida los rollos escaneados de un ítem (dentro de la transacción de
 * despacho) y devuelve lo que hay que guardar. Bloquea las filas de los
 * rollos para que dos despachos simultáneos no se lleven el mismo.
 */
export async function resolveDispatchRolls(
  tx: TxClient,
  dispatch: { id: number; clientId: number; productionOrderId: number | null },
  item: { productId: number },
  scanned: { code: string; token: string }[]
): Promise<{ id: number; weightKg: number }[]> {
  const found: Prisma.ProductionRollGetPayload<{ select: typeof ROLL_SELECT }>[] = [];
  const seen = new Set<number>();
  for (const s of scanned) {
    const code = s.code.trim().toUpperCase();
    const where = rollWhereFromCode(code);
    if (!where) throw new DispatchRollError(`Código de rollo inválido: ${code}`);
    const roll = await tx.productionRoll.findUnique({ where, select: ROLL_SELECT });
    if (!roll) throw new DispatchRollError(`No existe el rollo ${code}`);
    if (!s.token || !verifyPossessionToken(rollCodeOf(roll), s.token.trim().toUpperCase(), roll.possessionTokenHash)) {
      throw new DispatchRollError(`Falta demostrar posesión física del rollo ${rollCodeOf(roll)} — escaneá el QR de su etiqueta`);
    }
    if (seen.has(roll.id)) throw new DispatchRollError(`El rollo ${rollCodeOf(roll)} está repetido`);
    seen.add(roll.id);
    found.push(roll);
  }
  if (!found.length) return [];

  await tx.$queryRaw`SELECT id FROM production_rolls WHERE id IN (${Prisma.join(found.map((r) => r.id))}) FOR UPDATE`;

  const taken = await alreadyDispatched(tx, found.map((r) => r.id));
  for (const roll of found) {
    const code = rollCodeOf(roll);
    const order = roll.productionOrder;
    if (taken.has(roll.id)) throw new DispatchRollError(`El rollo ${code} ya salió en otro despacho`);
    if (dispatch.productionOrderId != null) {
      if (order.id !== dispatch.productionOrderId) {
        throw new DispatchRollError(
          `El rollo ${code} es de la OP ${order.orderNumber}, no de ${await orderNumberOf(tx, dispatch.productionOrderId)} — este despacho es de esa OP`
        );
      }
      continue;
    }
    if (order.productId !== item.productId) throw new DispatchRollError(`El rollo ${code} no es de este producto`);
    if (order.clientId != null && order.clientId !== dispatch.clientId) {
      const other = await tx.client.findUnique({ where: { id: order.clientId }, select: { name: true } });
      throw new DispatchRollError(`El rollo ${code} es de ${other?.name ?? "otro cliente"} (OP ${order.orderNumber}) — no se puede despachar a este cliente`);
    }
    const approved = order.status === "finalizada" && (await tx.qualityCheck.count({ where: { productionOrderId: order.id, result: "aprobado" } })) > 0;
    if (!approved) throw new DispatchRollError(`El rollo ${code} todavía no está aprobado en Calidad (OP ${order.orderNumber})`);
  }
  return found.map((r) => ({ id: r.id, weightKg: Math.round(rollProducedKg(r.station as OpStation, r) * 100) / 100 }));
}

async function orderNumberOf(tx: TxClient, orderId: number): Promise<string> {
  return (await tx.productionOrder.findUnique({ where: { id: orderId }, select: { orderNumber: true } }))?.orderNumber ?? `#${orderId}`;
}
