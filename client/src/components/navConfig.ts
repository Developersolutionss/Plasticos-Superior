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
 */

export interface NavLeaf {
  id: string;
  label: string;
  to?: string;
  disabled?: boolean;
}

export interface NavEntry {
  id: string;
  icon: string;
  label: string;
  to?: string;
  disabled?: boolean;
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
    icon: "🏠",
    label: "Dashboard",
    children: [
      { id: "dashboard-resumen", label: "Resumen general", disabled: true },
      { id: "dashboard-indicadores", label: "Indicadores", disabled: true },
    ],
  },
  {
    id: "clientes",
    icon: "👥",
    label: "Clientes",
    children: [
      { id: "clientes-listado", label: "Listado de clientes", to: "/clientes" },
      { id: "clientes-crear", label: "Crear cliente", to: "/clientes/nuevo" },
      { id: "clientes-contactos", label: "Contactos", to: "/clientes/contactos" },
      { id: "clientes-cotizaciones", label: "Cotizaciones", to: "/clientes/cotizaciones" },
    ],
  },
  { id: "despachos", icon: "🚚", label: "Despachos", to: "/despachos" },
  { id: "pedidos", icon: "📦", label: "Pedidos", to: "/pedidos" },
  { id: "facturas", icon: "🧾", label: "Facturas", to: "/facturas" },
  { id: "planeacion", icon: "📅", label: "Planeación", disabled: true },
  {
    id: "produccion",
    icon: "🏭",
    label: "Producción",
    children: [
      { id: "produccion-carga", label: "Carga de producción (Excel)", to: "/produccion" },
      { id: "produccion-ordenes", label: "Órdenes de producción", to: "/produccion/ordenes" },
      { id: "produccion-extrusion", label: "Extrusión", to: "/produccion/estacion/extrusion" },
      { id: "produccion-impresion", label: "Impresión", to: "/produccion/estacion/impresion" },
      { id: "produccion-sellado", label: "Sellado", to: "/produccion/estacion/sellado" },
      { id: "produccion-precorte", label: "Precorte", to: "/produccion/estacion/precorte" },
    ],
  },
  { id: "calidad", icon: "✅", label: "Calidad", disabled: true },
  { id: "trazabilidad", icon: "🔗", label: "Trazabilidad", disabled: true },
  {
    id: "inventario",
    icon: "📊",
    label: "Inventario",
    children: [
      { id: "inventario-existencias", label: "Existencias", to: "/" },
      { id: "inventario-productos", label: "Productos", disabled: true },
      { id: "inventario-movimientos", label: "Movimientos", disabled: true },
    ],
  },
  { id: "almacen", icon: "🏢", label: "Almacén / WMS", disabled: true },
  { id: "etiquetas", icon: "🏷️", label: "Etiquetas térmicas", disabled: true },
  { id: "escaneo", icon: "🔲", label: "Escaneo QR / Cód. barras", disabled: true },
  { id: "exportaciones", icon: "📤", label: "Exportaciones", disabled: true },
  { id: "notificaciones", icon: "🔔", label: "Notificaciones", disabled: true },
  {
    id: "auditoria",
    icon: "📜",
    label: "Auditoría",
    children: [{ id: "auditoria-bitacora", label: "Bitácora de inventario", disabled: true }],
  },
  {
    id: "configuracion",
    icon: "⚙️",
    label: "Configuración",
    children: [
      { id: "configuracion-auth", label: "Autenticación", disabled: true },
      { id: "configuracion-usuarios", label: "Usuarios y permisos", disabled: true },
    ],
  },
];

/** Devuelve todos los ítems elegibles como atajos, agrupados por categoría. */
export function buildChoices(): NavChoice[] {
  const out: NavChoice[] = [];
  for (const entry of navSections) {
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