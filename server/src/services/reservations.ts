import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../prisma";
import type { TxClient } from "./stockService";
import { ROLL_CODE_PREFIX, rollProducedKg, type OpStation } from "./opTemplates";

/**
 * Reservas para clientes (reunión con el cliente, 2026-10-06): lo que se
 * fabricó para un cliente entra al inventario como siempre (al aprobar
 * Calidad), pero queda apartado para él — si no, alguien ve "900 kg, sobra" y
 * los despacha a otro, y el cliente se queda sin su pedido.
 *
 * No hay una tabla de reservas aparte: la reserva ES el despacho que Calidad
 * genera solo al aprobar una OP con cliente (`Dispatch.productionOrderId`),
 * mientras siga abierto (pendiente / en proceso) y por sus ítems que todavía
 * no salieron. Así hay una sola fuente de verdad:
 * - despacharlo al cliente consume la reserva;
 * - cancelarlo la libera (esos kilos pasan a stock libre y se pueden
 *   despachar a otro cliente);
 * - reabrir la OP ya está bloqueado mientras exista ese despacho.
 */
const OPEN_DISPATCH: Prisma.DispatchWhereInput = { productionOrderId: { not: null }, status: { in: ["pendiente", "en_proceso"] } };

/** Kilos (o unidades) reservados por producto. `excludeDispatchId`: no contar
 * la reserva de ese despacho (para que un despacho de cliente no se bloquee
 * con su propia reserva). */
export async function reservedByProduct(
  tx: TxClient | typeof prisma,
  options: { productIds?: number[]; excludeDispatchId?: number } = {}
): Promise<Map<number, number>> {
  const rows = await tx.dispatchItem.groupBy({
    by: ["productId"],
    where: {
      quantityDispatched: null,
      ...(options.productIds ? { productId: { in: options.productIds } } : {}),
      dispatch: { ...OPEN_DISPATCH, ...(options.excludeDispatchId ? { id: { not: options.excludeDispatchId } } : {}) },
    },
    _sum: { quantityRequested: true },
  });
  return new Map(rows.map((r) => [r.productId, Math.round(Number(r._sum.quantityRequested ?? 0) * 100) / 100]));
}

/** Para quién está reservado un producto (el mensaje de "no se puede"). */
export async function reservationHolders(tx: TxClient | typeof prisma, productId: number, excludeDispatchId?: number) {
  const items = await tx.dispatchItem.findMany({
    where: {
      productId,
      quantityDispatched: null,
      dispatch: { ...OPEN_DISPATCH, ...(excludeDispatchId ? { id: { not: excludeDispatchId } } : {}) },
    },
    select: {
      quantityRequested: true,
      dispatch: { select: { client: { select: { name: true } }, productionOrder: { select: { orderNumber: true } } } },
    },
    orderBy: { id: "asc" },
  });
  return items.map((i) => ({
    clientName: i.dispatch.client.name,
    orderNumber: i.dispatch.productionOrder?.orderNumber ?? "",
    quantity: Number(i.quantityRequested),
  }));
}

/**
 * "Rollos para clientes": cada reserva abierta con su cliente, su OP, el
 * producto, cuánto queda por despachar y los rollos/bultos que la OP
 * produjo (código, kilos).
 */
export async function clientReservations() {
  const dispatches = await prisma.dispatch.findMany({
    where: OPEN_DISPATCH,
    select: {
      id: true,
      status: true,
      requestedDate: true,
      client: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          quantityRequested: true,
          quantityDispatched: true,
          product: { select: { id: true, sku: true, name: true, unit: true } },
        },
        orderBy: { id: "asc" },
      },
      productionOrder: {
        select: {
          id: true,
          orderNumber: true,
          station: true,
          qualityCheck: { select: { createdAt: true } },
          rolls: {
            select: { id: true, station: true, stationSequence: true, label: true, weightKg: true, details: true },
            orderBy: { stationSequence: "asc" },
          },
        },
      },
    },
    orderBy: [{ requestedDate: "asc" }, { id: "asc" }],
  });

  return dispatches.map((d) => {
    const order = d.productionOrder!;
    const pending = d.items.filter((i) => i.quantityDispatched == null);
    return {
      dispatchId: d.id,
      status: d.status,
      client: d.client,
      productionOrder: { id: order.id, orderNumber: order.orderNumber, station: order.station },
      approvedAt: order.qualityCheck?.createdAt ?? d.requestedDate,
      items: d.items.map((i) => ({
        id: i.id,
        product: i.product,
        quantityRequested: Number(i.quantityRequested),
        quantityDispatched: i.quantityDispatched != null ? Number(i.quantityDispatched) : null,
      })),
      reservedQuantity: Math.round(pending.reduce((acc, i) => acc + Number(i.quantityRequested), 0) * 100) / 100,
      rolls: order.rolls.map((r) => ({
        id: r.id,
        code: `${ROLL_CODE_PREFIX[r.station as OpStation]}-${r.stationSequence}`,
        label: r.label,
        weightKg: Math.round(rollProducedKg(r.station as OpStation, r) * 100) / 100,
      })),
    };
  });
}
