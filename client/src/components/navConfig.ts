/**
 * Estructura del menú lateral. Cada módulo del roadmap de 20 módulos tiene su
 * ítem acá, aunque todavía no esté construido — los que no tienen `to` (o
 * tienen `disabled: true`) se muestran deshabilitados con la etiqueta
 * "Próximamente", para que el cliente vea el alcance completo del sistema.
 *
 * Cuando se termine un módulo nuevo, alcanza con agregarle su `to` (y el de
 * sus hijos) acá para que aparezca habilitado — no hace falta tocar Sidebar.tsx.
 */
export interface NavLeaf {
  label: string;
  to?: string;
  disabled?: boolean;
}

export interface NavEntry {
  icon: string;
  label: string;
  to?: string;
  disabled?: boolean;
  children?: NavLeaf[];
}

export const quickActions: NavLeaf[] = [
  { label: "Cargar producción", to: "/produccion" },
  { label: "Nueva orden", disabled: true },
];

export const favorites: NavLeaf[] = [
  { label: "Inventario", to: "/" },
  { label: "Despachos", to: "/despachos" },
];

export const navSections: NavEntry[] = [
  {
    icon: "🏠",
    label: "Dashboard",
    children: [
      { label: "Resumen general", disabled: true },
      { label: "Indicadores", disabled: true },
    ],
  },
  {
    icon: "👥",
    label: "Clientes",
    children: [
      { label: "Listado de clientes", disabled: true },
      { label: "Crear cliente", disabled: true },
      { label: "Contactos", disabled: true },
    ],
  },
  { icon: "🚚", label: "Despachos", to: "/despachos" },
  { icon: "📦", label: "Pedidos", disabled: true },
  { icon: "📅", label: "Planeación", disabled: true },
  {
    icon: "🏭",
    label: "Producción",
    children: [
      { label: "Carga de producción (Excel)", to: "/produccion" },
      { label: "Órdenes de producción", disabled: true },
      { label: "Extrusión", disabled: true },
      { label: "Impresión", disabled: true },
      { label: "Sellado", disabled: true },
      { label: "Precorte", disabled: true },
    ],
  },
  { icon: "✅", label: "Calidad", disabled: true },
  { icon: "🔗", label: "Trazabilidad", disabled: true },
  {
    icon: "📊",
    label: "Inventario",
    children: [
      { label: "Existencias", to: "/" },
      { label: "Productos", disabled: true },
      { label: "Movimientos", disabled: true },
    ],
  },
  { icon: "🏢", label: "Almacén / WMS", disabled: true },
  { icon: "🏷️", label: "Etiquetas térmicas", disabled: true },
  { icon: "🔲", label: "Escaneo QR / Cód. barras", disabled: true },
  { icon: "📤", label: "Exportaciones", disabled: true },
  { icon: "🔔", label: "Notificaciones", disabled: true },
  {
    icon: "📜",
    label: "Auditoría",
    children: [{ label: "Bitácora de inventario", disabled: true }],
  },
  {
    icon: "⚙️",
    label: "Configuración",
    children: [
      { label: "Autenticación", disabled: true },
      { label: "Usuarios y permisos", disabled: true },
    ],
  },
];
