import { AsyncLocalStorage } from "node:async_hooks";

export interface AuditContext {
  userId?: number;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * La extensión de Prisma (auditExtension.ts) no tiene acceso al `req` de
 * Express, así que necesita otra forma de saber quién hizo la petición
 * actual. `requireAuth` guarda acá el contexto apenas valida el token, y
 * se mantiene disponible durante toda la cadena async de esa request
 * (Node trackea esto automáticamente a través de awaits/callbacks).
 */
export const auditContext = new AsyncLocalStorage<AuditContext>();
