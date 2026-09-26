/**
 * Corrige los campos de lista (kind "options") de las OPs ya guardadas que
 * tienen un valor que no es exactamente una de sus opciones — texto libre
 * cargado antes de que esos campos fueran listas cerradas ("alta" en vez de
 * "ALTA", "trasparente", caras "ambas"...). Usa la misma regla que el
 * servidor aplica ahora al guardar (normalizeSpecOptions en
 * services/opTemplates.ts).
 *
 * Lo que no corresponde a ninguna opción (ej. color "Natural", fuelles "2")
 * NO se toca: se lista al final para que Gestión elija el valor correcto a
 * mano desde la hoja de la OP (ahí se ve marcado en rojo como "no válido").
 *
 * Uso (desde server/):
 *   npx tsx scripts/normalize-spec-options.ts           -> solo muestra qué cambiaría
 *   npx tsx scripts/normalize-spec-options.ts --apply   -> lo guarda
 */
import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/prisma";
import { normalizeSpecOptions, OpStation } from "../src/services/opTemplates";

async function main() {
  const apply = process.argv.includes("--apply");
  const orders = await prisma.productionOrder.findMany({
    where: { station: { not: null } },
    select: { id: true, orderNumber: true, station: true, specs: true },
    orderBy: { id: "asc" },
  });

  let changedCount = 0;
  const unresolved: string[] = [];

  for (const order of orders) {
    if (!order.specs || typeof order.specs !== "object" || Array.isArray(order.specs)) continue;
    const before = order.specs as Record<string, unknown>;
    const { specs: after, issues } = normalizeSpecOptions(order.station as OpStation, before);
    const tag = `${order.orderNumber} (#${order.id}, ${order.station})`;

    const changes = Object.keys(after).filter((k) => after[k] !== before[k]);
    if (changes.length > 0) {
      changedCount++;
      for (const k of changes) console.log(`${tag}: ${k} "${String(before[k])}" -> "${String(after[k])}"`);
      if (apply) {
        await prisma.productionOrder.update({ where: { id: order.id }, data: { specs: after as Prisma.InputJsonValue } });
      }
    }
    for (const issue of issues) {
      unresolved.push(`${tag}: ${issue.label} = "${String(issue.value)}" (opciones: ${issue.options.join(", ")})`);
    }
  }

  console.log(`\n${changedCount} OP(s) con valores normalizables${apply ? " — GUARDADO" : " — modo prueba, no se guardó nada (usá --apply)"}.`);
  if (unresolved.length > 0) {
    console.log(`\n${unresolved.length} valor(es) que no corresponden a ninguna opción — corregir a mano desde la hoja de la OP:`);
    for (const line of unresolved) console.log(`  - ${line}`);
  } else {
    console.log("Ningún valor fuera de lista sin resolver.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
