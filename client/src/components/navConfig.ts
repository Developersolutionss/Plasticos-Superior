import type { UserRole } from "../auth/AuthContext";

/**
 * Estructura del menú lateral. Cada módulo del roadmap de 20 módulos tiene su
 * ítem acá, aunque todavía no esté construido — los que no tienen `to` (o
 * tienen `disabled: true`) se muestran deshabilitados con la etiqueta
 * "Próximamente", para que el cliente vea el alcance completo del sistema.
 *
 * `id` es una clave estable única por ítem; se usa para perseguir qué ítems
 * están marcados como atajos (ver useShortcuts.tsx) y debe permanecer estable
 * entre recargas y cambios de label. Cuando se termine un módulo nuevo, alcanza
 * con agregarle su `to` (y el de sus hijos) acá para que aparezca habilitado —
 * no hace falta tocar Sidebar.tsx.
 *
 * `roles` define quién ve cada ítem (cada rol solo debe ver lo que le
 * corresponde). Si se omite, hereda los roles del padre; en un `NavEntry` sin
 * `roles` propio ni heredado, por defecto solo lo ven super_admin/admin. Esto
 * es solo la capa de UI — el backend (server/src/middleware/auth.ts, ROLES)
 * es quien realmente hace cumplir el permiso en cada endpoint.
 */

export const ADMIN: UserRole[] = ["super_admin", "admin"];
export const VENTAS: UserRole[] = [...ADMIN, "ventas_pedidos"];
export const ALMACEN: UserRole[] = [...ADMIN, "almacen_despachos"];
export const PRODUCCION_GESTION: UserRole[] = [...ADMIN, "gerente_produccion", "planeacion"];
export const OPERARIOS: UserRole[] = [...PRODUCCION_GESTION, "operario_extrusion", "operario_impresion", "operario_sellado_precorte"];
export const OP_EXTRUSION: UserRole[] = [...PRODUCCION_GESTION, "operario_extrusion"];
export const OP_IMPRESION: UserRole[] = [...PRODUCCION_GESTION, "operario_impresion"];
export const OP_SELLADO: UserRole[] = [...PRODUCCION_GESTION, "operario_sellado_precorte"];
export const CALIDAD: UserRole[] = [...ADMIN, "calidad"];
export const AUDITORIA: UserRole[] = [...ADMIN, "auditor"];
const INVENTARIO: UserRole[] = [...ADMIN, "almacen_despachos", "gerente_produccion", "planeacion", "ventas_pedidos"];
const TODOS: UserRole[] = [
  "super_admin",
  "admin",
  "gerente_produccion",
  "planeacion",
  "ventas_pedidos",
  "operario_extrusion",
  "operario_impresion",
  "operario_sellado_precorte",
  "calidad",
  "almacen_despachos",
  "auditor",
];

export interface NavLeaf {
  id: string;
  label: string;
  to?: string;
  disabled?: boolean;
  roles?: UserRole[];
}

export interface NavEntry {
  id: string;
  icon: string;
  label: string;
  to?: string;
  disabled?: boolean;
  roles?: UserRole[];
  children?: NavLeaf[];
}

export interface NavChoice {
  id: string;
  icon: string;
  label: string;
  group: string;
  to?: string;
  disabled?: boolean;
}

export const navSections: NavEntry[] = [
  {
    id: "dashboard",
    icon: "layout-dashboard",
    label: "Dashboard",
    roles: TODOS,
    children: [
      { id: "dashboard-resumen", label: "Resumen general", disabled: true },
      { id: "dashboard-indicadores", label: "Indicadores", disabled: true },
    ],
  },
  {
    id: "clientes",
    icon: "users",
    label: "Clientes",
    roles: VENTAS,
    children: [
      { id: "clientes-listado", label: "Listado de clientes", to: "/clientes" },
      { id: "clientes-contactos", label: "Contactos", to: "/clientes/contactos" },
      { id: "clientes-cotizaciones", label: "Cotizaciones", to: "/clientes/cotizaciones" },
    ],
  },
  { id: "despachos", icon: "truck", label: "Despachos", to: "/despachos", roles: ALMACEN },
  { id: "pedidos", icon: "package", label: "Pedidos", to: "/pedidos", roles: VENTAS },
  { id: "facturas", icon: "receipt", label: "Facturas", to: "/facturas", roles: VENTAS },
  { id: "planeacion", icon: "calendar-days", label: "Planeación", to: "/planeacion", roles: PRODUCCION_GESTION },
  {
    id: "produccion",
    icon: "factory",
    label: "Producción",
    roles: OPERARIOS,
    children: [
      { id: "produccion-carga", label: "Carga de producción (Excel)", to: "/produccion", roles: [...ALMACEN, ...PRODUCCION_GESTION] },
      { id: "produccion-ordenes", label: "Órdenes de producción", to: "/produccion/ordenes", roles: PRODUCCION_GESTION },
      { id: "produccion-extrusion", label: "Extrusión", to: "/produccion/estacion/extrusion", roles: OP_EXTRUSION },
      { id: "produccion-impresion", label: "Impresión", to: "/produccion/estacion/impresion", roles: OP_IMPRESION },
      { id: "produccion-sellado", label: "Sellado", to: "/produccion/estacion/sellado", roles: OP_SELLADO },
      { id: "produccion-precorte", label: "Precorte", to: "/produccion/estacion/precorte", roles: OP_SELLADO },
    ],
  },
  { id: "calidad", icon: "badge-check", label: "Calidad", to: "/calidad", roles: CALIDAD },
  {
    id: "trazabilidad",
    icon: "link",
    label: "Trazabilidad",
    to: "/trazabilidad",
    roles: [...PRODUCCION_GESTION, ...CALIDAD, ...AUDITORIA],
  },
  {
    id: "inventario",
    icon: "bar-chart",
    label: "Inventario",
    roles: INVENTARIO,
    children: [
      { id: "inventario-existencias", label: "Existencias", to: "/" },
      { id: "inventario-productos", label: "Productos", disabled: true },
      { id: "inventario-movimientos", label: "Movimientos", disabled: true },
    ],
  },
  { id: "almacen", icon: "warehouse", label: "Almacén / WMS", to: "/almacen", roles: ALMACEN },
  { id: "etiquetas", icon: "tag", label: "Etiquetas térmicas", disabled: true, roles: ALMACEN },
  { id: "escaneo", icon: "scan-line", label: "Escaneo QR / Cód. barras", disabled: true, roles: ALMACEN },
  { id: "exportaciones", icon: "download", label: "Exportaciones", disabled: true, roles: ADMIN },
  { id: "notificaciones", icon: "bell", label: "Notificaciones", disabled: true, roles: TODOS },
  {
    id: "auditoria",
    icon: "scroll-text",
    label: "Auditoría",
    roles: AUDITORIA,
    children: [{ id: "auditoria-bitacora", label: "Bitácora de auditoría", to: "/auditoria" }],
  },
  {
    id: "configuracion",
    icon: "settings",
    label: "Configuración",
    roles: ADMIN,
    children: [
      { id: "configuracion-auth", label: "Autenticación", to: "/configuracion/autenticacion" },
      { id: "configuracion-usuarios", label: "Usuarios y permisos", disabled: true },
    ],
  },
];

/** Filtra las secciones del menú según lo que le corresponde ver a `role`. */
export function filterNavSections(role: UserRole): NavEntry[] {
  return navSections
    .filter((entry) => (entry.roles ?? ADMIN).includes(role))
    .map((entry) => {
      if (!entry.children?.length) return entry;
      const children = entry.children.filter((child) => (child.roles ?? entry.roles ?? ADMIN).includes(role));
      return { ...entry, children };
    })
    .filter((entry) => !entry.children || entry.children.length > 0);
}

/** Devuelve todos los ítems elegibles como atajos, agrupados por categoría, para el rol dado. */
export function buildChoices(role: UserRole): NavChoice[] {
  const out: NavChoice[] = [];
  for (const entry of filterNavSections(role)) {
    if (entry.children?.length) {
      for (const child of entry.children) {
        out.push({
          id: child.id,
          icon: entry.icon,
          label: child.label,
          group: entry.label,
          to: child.to,
          disabled: child.disabled,
        });
      }
    } else {
      out.push({ id: entry.id, icon: entry.icon, label: entry.label, group: entry.label, to: entry.to, disabled: entry.disabled });
    }
  }
  return out;
}