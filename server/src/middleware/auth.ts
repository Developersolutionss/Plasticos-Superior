import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { UserRole } from "../generated/prisma/client";

export interface AuthPayload {
  userId: number;
  role: UserRole;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no provisto" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "No tienes permiso para esta acción" });
    }
    next();
  };
}

/**
 * Grupos de roles reutilizables por los distintos módulos, para no repetir
 * la misma lista larga en cada ruta. super_admin/admin quedan afuera de
 * estos grupos porque routes.ts los agrega aparte (siempre tienen acceso).
 */
export const ROLES = {
  ADMIN: ["super_admin", "admin"] as UserRole[],
  VENTAS: ["super_admin", "admin", "ventas_pedidos"] as UserRole[],
  ALMACEN: ["super_admin", "admin", "almacen_despachos"] as UserRole[],
  PRODUCCION_GESTION: ["super_admin", "admin", "gerente_produccion", "planeacion"] as UserRole[],
  OPERARIOS: [
    "super_admin",
    "admin",
    "gerente_produccion",
    "planeacion",
    "operario_extrusion",
    "operario_impresion",
    "operario_sellado_precorte",
  ] as UserRole[],
};

/**
 * Estaciones de planta que le corresponden a cada rol de operario (para
 * /production-orders/:id/stages) — "operario_sellado_precorte" es un solo
 * rol que cubre las dos últimas estaciones, tal como lo nombra la propuesta
 * original ("Operario Sellado-Precorte").
 */
export const OPERARIO_STATIONS: Partial<Record<UserRole, string[]>> = {
  operario_extrusion: ["extrusion"],
  operario_impresion: ["impresion"],
  operario_sellado_precorte: ["sellado", "precorte"],
};
