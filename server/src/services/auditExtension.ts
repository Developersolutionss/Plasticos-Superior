import type { PrismaClient } from "../generated/prisma/client";
import { auditContext } from "./auditContext";

/**
 * Tablas críticas que quedan auditadas automáticamente (create/update/
 * delete) con diff antes/después + quién/desde-dónde. Agregar un modelo acá
 * alcanza para auditarlo — no hace falta tocar sus routers.
 */
const AUDITED_MODELS = new Set(["Client", "Dispatch", "ProductionEntry", "InventoryMovement"]);

const AUDITED_OPERATIONS = new Set(["create", "update", "delete"]);

/** Sólo Prisma.Decimal/Date necesitan esto para caber en una columna Json. */
function toPlainJson(value: unknown) {
  return value === null || value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function modelPropertyName(model: string) {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Envuelve el PrismaClient base con un `$extends` que intercepta las
 * mutaciones sobre AUDITED_MODELS y escribe un AuditLog con el estado
 * antes/después. Usa `basePrisma` (no el cliente extendido) para el
 * find-previo y para el propio `auditLog.create`, así esa lectura/escritura
 * interna no se re-audita ni entra en recursión.
 */
export function withAudit(basePrisma: PrismaClient) {
  return basePrisma.$extends({
    name: "auditLog",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!AUDITED_MODELS.has(model) || !AUDITED_OPERATIONS.has(operation)) {
            return query(args);
          }

          const prop = modelPropertyName(model) as keyof PrismaClient;
          let before: unknown = null;
          if (operation === "update" || operation === "delete") {
            before = await (basePrisma[prop] as any)
              .findUnique({ where: (args as any).where })
              .catch(() => null);
          }

          const result = await query(args);

          const ctx = auditContext.getStore();
          await basePrisma.auditLog.create({
            data: {
              tableName: model,
              recordId: (result as any)?.id ?? (before as any)?.id ?? null,
              action: operation as "create" | "update" | "delete",
              before: toPlainJson(before),
              after: operation === "delete" ? undefined : toPlainJson(result),
              userId: ctx?.userId,
              ipAddress: ctx?.ipAddress,
              userAgent: ctx?.userAgent,
            },
          });

          return result;
        },
      },
    },
  });
}
