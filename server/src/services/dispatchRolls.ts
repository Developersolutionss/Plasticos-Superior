import { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import type { TxClient } from "./stockService";
import { ROLL_CODE_PREFIX, STATION_LABELS, WAREHOUSE_LABELS, rollProducedKg, type OpStation } from "./opTemplates";
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
  /** Dónde está físicamente (ej. "Bodega principal", "Sellado", "En camino a Bodega principal"). */
  location: string;
  /** El despacho al cliente sale de la bodega principal: `false` = todavía
   * hay que devolverlo (se avisa, no se bloquea). */
  inMainWarehouse: boolean;
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
  transfers: { orderBy: { id: "desc" }, take: 1, select: { status: true, toStation: true } },
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
          // Producto terminado: OP aprobada en Calidad (solo la etapa final
          // pasa por Calidad), de cualquier estación — el orden no es fijo.
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
      .map((r) => {
        const last = r.transfers[0];
        const where = last?.status === "recibido" ? last.toStation : (r.station as OpStation);
        return {
          id: r.id,
          code: rollCodeOf(r),
          label: r.label,
          weightKg: Math.round(rollProducedKg(r.station as OpStation, r) * 100) / 100,
          orderNumber: r.productionOrder.orderNumber,
          origin: r.productionOrder.clientId == null ? ("stock" as const) : ("cliente" as const),
          location: last?.status === "en_transito" ? `En camino a ${WAREHOUSE_LABELS[last.toStation]}` : where === "principal" ? WAREHOUSE_LABELS.principal : STATION_LABELS[where],
          inMainWarehouse: last?.status !== "en_transito" && where === "principal",
        };
      }),
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

export interface DispatchTarget {
  dispatchId: number;
  itemId: number;
  clientName: string;
  reserved: boolean;
  quantityRequested: number;
}

/**
 * Escanear el QR de un rollo en Despachos: a qué ítem(s) pendiente(s) puede
 * ir. Primero la reserva de su propia OP; si no tiene, los despachos a mano
 * abiertos del mismo producto para su cliente (o para cualquiera si es stock
 * libre). Verifica el token del QR. `reason` explica por qué no hay ninguno.
 */
export async function dispatchTargetsForRoll(code: string, token: string): Promise<{ code: string; targets: DispatchTarget[]; reason: string | null }> {
  const clean = code.trim().toUpperCase();
  const where = rollWhereFromCode(clean);
  if (!where) throw new DispatchRollError(`Código de rollo inválido: ${clean}`);
  const roll = await prisma.productionRoll.findUnique({ where, select: ROLL_SELECT });
  if (!roll) throw new DispatchRollError(`No existe el rollo ${clean}`);
  const rollCode = rollCodeOf(roll);
  if (!token || !verifyPossessionToken(rollCode, token.trim().toUpperCase(), roll.possessionTokenHash)) {
    throw new DispatchRollError(`Falta demostrar posesión física del rollo ${rollCode} — escaneá el QR de su etiqueta`);
  }
  if ((await alreadyDispatched(prisma, [roll.id])).size > 0) {
    return { code: rollCode, targets: [], reason: `El rollo ${rollCode} ya salió hacia un cliente en otro despacho` };
  }
  const order = roll.productionOrder;
  const pendingItem = { quantityDispatched: null, productId: order.productId };
  const open = { status: { in: ["pendiente", "en_proceso"] as ("pendiente" | "en_proceso")[] } };
  const toTarget = (i: { id: number; quantityRequested: unknown; dispatch: { id: number; productionOrderId: number | null; client: { name: string } } }) => ({
    dispatchId: i.dispatch.id,
    itemId: i.id,
    clientName: i.dispatch.client.name,
    reserved: i.dispatch.productionOrderId != null,
    quantityRequested: Number(i.quantityRequested),
  });
  const select = { id: true, quantityRequested: true, dispatch: { select: { id: true, productionOrderId: true, client: { select: { name: true } } } } } as const;

  const reservedItems = await prisma.dispatchItem.findMany({
    where: { ...pendingItem, dispatch: { ...open, productionOrderId: order.id } },
    select,
    orderBy: { id: "asc" },
  });
  if (reservedItems.length) return { code: rollCode, targets: reservedItems.map(toTarget), reason: null };

  const approved = order.status === "finalizada" && (await prisma.qualityCheck.count({ where: { productionOrderId: order.id, result: "aprobado" } })) > 0;
  if (!approved) {
    return { code: rollCode, targets: [], reason: `El rollo ${rollCode} todavía no está aprobado en Calidad (OP ${order.orderNumber})` };
  }
  const manualItems = await prisma.dispatchItem.findMany({
    where: { ...pendingItem, dispatch: { ...open, productionOrderId: null, ...(order.clientId != null ? { clientId: order.clientId } : {}) } },
    select,
    orderBy: { id: "asc" },
  });
  return {
    code: rollCode,
    targets: manualItems.map(toTarget),
    reason: manualItems.length ? null : `No hay ningún despacho abierto de este producto${order.clientId != null ? " para su cliente" : ""} donde pueda salir el rollo ${rollCode}`,
  };
}

async function orderNumberOf(tx: TxClient, orderId: number): Promise<string> {
  return (await tx.productionOrder.findUnique({ where: { id: orderId }, select: { orderNumber: true } }))?.orderNumber ?? `#${orderId}`;
}
