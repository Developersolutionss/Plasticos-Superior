import { prisma } from "../prisma";

/**
 * Rollos de Extrusión que todavía tienen material (decisión del cliente,
 * 2026-10-21: los rollos de Extrusión entran al inventario, y hay que saber
 * cuántos hay). Se cuentan aparte del stock de producto terminado: este
 * material se consume en las OPs derivadas (Impresión, Sellado, Precorte), y
 * ese producto terminado suma al aprobar Calidad — sumarlo también acá
 * contaría dos veces el mismo material.
 *
 * Por producto: cuántos rollos y cuántos kilos quedan (saldo real: peso −
 * lo consumido + ajustes), separados entre general (OP sin cliente) y de
 * cada cliente (OP con cliente).
 */
export interface ExtrusionRollGroup {
  rollCount: number;
  kg: number;
}

export interface ExtrusionRollsByProduct {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  rollCount: number;
  totalKg: number;
  general: ExtrusionRollGroup;
  clients: ({ clientId: number; clientName: string } & ExtrusionRollGroup)[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function extrusionRollsInventory(): Promise<ExtrusionRollsByProduct[]> {
  const rolls = await prisma.productionRoll.findMany({
    where: { station: "extrusion" },
    select: {
      id: true,
      weightKg: true,
      productionOrder: {
        select: {
          productId: true,
          product: { select: { sku: true, name: true, unit: true } },
          client: { select: { id: true, name: true } },
        },
      },
    },
  });
  const ids = rolls.map((r) => r.id);
  const [consumed, adjusted] = await Promise.all([
    prisma.rollConsumption.groupBy({ by: ["sourceRollId"], where: { sourceRollId: { in: ids } }, _sum: { quantityKg: true } }),
    prisma.rollAdjustment.groupBy({ by: ["rollId"], where: { rollId: { in: ids } }, _sum: { deltaKg: true } }),
  ]);
  const consumedBy = new Map(consumed.map((c) => [c.sourceRollId, Number(c._sum.quantityKg ?? 0)]));
  const adjustedBy = new Map(adjusted.map((a) => [a.rollId, Number(a._sum.deltaKg ?? 0)]));

  const byProduct = new Map<number, ExtrusionRollsByProduct>();
  for (const r of rolls) {
    const remaining = Number(r.weightKg) - (consumedBy.get(r.id) ?? 0) + (adjustedBy.get(r.id) ?? 0);
    if (remaining <= 0.005) continue; // ya se consumió entero
    const o = r.productionOrder;
    const entry =
      byProduct.get(o.productId) ??
      ({
        productId: o.productId,
        sku: o.product.sku,
        name: o.product.name,
        unit: o.product.unit,
        rollCount: 0,
        totalKg: 0,
        general: { rollCount: 0, kg: 0 },
        clients: [],
      } as ExtrusionRollsByProduct);
    byProduct.set(o.productId, entry);
    entry.rollCount += 1;
    entry.totalKg += remaining;
    if (!o.client) {
      entry.general.rollCount += 1;
      entry.general.kg += remaining;
    } else {
      let c = entry.clients.find((x) => x.clientId === o.client!.id);
      if (!c) entry.clients.push((c = { clientId: o.client.id, clientName: o.client.name, rollCount: 0, kg: 0 }));
      c.rollCount += 1;
      c.kg += remaining;
    }
  }

  return [...byProduct.values()]
    .map((p) => ({
      ...p,
      totalKg: round2(p.totalKg),
      general: { ...p.general, kg: round2(p.general.kg) },
      clients: p.clients.map((c) => ({ ...c, kg: round2(c.kg) })).sort((a, b) => a.clientName.localeCompare(b.clientName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
