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
  /** Encabezado de sección que se muestra arriba de este ítem cuando cambia
   * respecto del ítem anterior visible para el rol actual (ver Sidebar.tsx).
   * Sin `group`, el ítem no lleva separador arriba (ej. Dashboard, primero). */
  group?: string;
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
      { id: "dashboard-resumen", label: "Resumen general", to: "/dashboard-ejecutivo", roles: ADMIN },
      { id: "dashboard-indicadores", label: "Indicadores", to: "/dashboard-indicadores", roles: ADMIN },
    ],
  },
  {
    id: "clientes",
    icon: "users",
    label: "Clientes",
    roles: VENTAS,
    group: "Ventas",
    children: [
      { id: "clientes-listado", label: "Listado de clientes", to: "/clientes" },
      { id: "clientes-contactos", label: "Contactos", to: "/clientes/contactos" },
      { id: "clientes-cotizaciones", label: "Cotizaciones", to: "/clientes/cotizaciones" },
    ],
  },
  { id: "despachos", icon: "truck", label: "Despachos", to: "/despachos", roles: ALMACEN, group: "Ventas" },
  { id: "pedidos", icon: "package", label: "Pedidos", to: "/pedidos", roles: VENTAS, group: "Ventas" },
  { id: "facturas", icon: "receipt", label: "Facturas", to: "/facturas", roles: VENTAS, group: "Ventas" },
  {
    id: "planeacion",
    icon: "calendar-days",
    label: "Planeación",
    to: "/planeacion",
    roles: PRODUCCION_GESTION,
    group: "Producción",
  },
  {
    id: "produccion",
    icon: "factory",
    label: "Producción",
    roles: OPERARIOS,
    group: "Producción",
    children: [
      { id: "produccion-carga", label: "Carga de producción (Excel)", to: "/produccion", roles: [...ALMACEN, ...PRODUCCION_GESTION] },
      { id: "produccion-ordenes", label: "Órdenes de producción", to: "/produccion/ordenes", roles: PRODUCCION_GESTION },
      { id: "produccion-extrusion", label: "Extrusión", to: "/produccion/estacion/extrusion", roles: OP_EXTRUSION },
      { id: "produccion-impresion", label: "Impresión", to: "/produccion/estacion/impresion", roles: OP_IMPRESION },
      { id: "produccion-sellado", label: "Sellado", to: "/produccion/estacion/sellado", roles: OP_SELLADO },
      { id: "produccion-precorte", label: "Precorte", to: "/produccion/estacion/precorte", roles: OP_SELLADO },
    ],
  },
  { id: "calidad", icon: "badge-check", label: "Calidad", to: "/calidad", roles: CALIDAD, group: "Producción" },
  {
    id: "trazabilidad",
    icon: "link",
    label: "Trazabilidad",
    to: "/trazabilidad",
    roles: [...PRODUCCION_GESTION, ...CALIDAD, ...AUDITORIA],
    group: "Producción",
  },
  {
    id: "inventario",
    icon: "bar-chart",
    label: "Inventario",
    roles: INVENTARIO,
    group: "Inventario",
    children: [
      { id: "inventario-existencias", label: "Existencias", to: "/" },
      { id: "inventario-productos", label: "Productos", to: "/inventario/productos", roles: PRODUCCION_GESTION },
      { id: "inventario-movimientos", label: "Movimientos", to: "/inventario/movimientos", roles: ALMACEN },
    ],
  },
  { id: "almacen", icon: "warehouse", label: "Almacén / WMS", to: "/almacen", roles: ALMACEN, group: "Inventario" },
  { id: "exportaciones", icon: "download", label: "Exportaciones", to: "/exportaciones", roles: ADMIN, group: "Sistema" },
  { id: "notificaciones", icon: "bell", label: "Notificaciones", to: "/notificaciones", roles: TODOS, group: "Sistema" },
  {
    id: "auditoria",
    icon: "scroll-text",
    label: "Auditoría",
    roles: AUDITORIA,
    group: "Sistema",
    children: [{ id: "auditoria-bitacora", label: "Bitácora de auditoría", to: "/auditoria" }],
  },
  {
    id: "configuracion",
    icon: "settings",
    label: "Configuración",
    // TODOS a nivel de sección para que "Apariencia" (preferencia personal)
    // sea visible para cualquier rol; los hijos de seguridad/administración
    // fijan `roles: ADMIN` explícito para no heredar este TODOS.
    roles: TODOS,
    group: "Sistema",
    children: [
      { id: "configuracion-auth", label: "Autenticación", to: "/configuracion/autenticacion", roles: ADMIN },
      { id: "configuracion-usuarios", label: "Usuarios y permisos", to: "/configuracion/usuarios", roles: ADMIN },
      { id: "configuracion-apariencia", label: "Apariencia", to: "/configuracion/apariencia" },
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