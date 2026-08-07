import {
  LayoutDashboard,
  Users,
  Truck,
  Package,
  Receipt,
  CalendarDays,
  Factory,
  BadgeCheck,
  Link2,
  BarChart3,
  Warehouse,
  Tag,
  ScanLine,
  Download,
  Bell,
  ScrollText,
  Settings,
  type LucideIcon,
} from "lucide-react";

/**
 * Mapa de claves (usadas en navConfig.ts) a íconos de lucide-react. Antes
 * el sidebar usaba emojis como ícono — para un ERP esto se ve poco serio
 * y además rinde distinto según SO/fuente instalada, por eso se
 * reemplazó por íconos SVG consistentes.
 */
const ICONS: Record<string, LucideIcon> = {
  "layout-dashboard": LayoutDashboard,
  users: Users,
  truck: Truck,
  package: Package,
  receipt: Receipt,
  "calendar-days": CalendarDays,
  factory: Factory,
  "badge-check": BadgeCheck,
  link: Link2,
  "bar-chart": BarChart3,
  warehouse: Warehouse,
  tag: Tag,
  "scan-line": ScanLine,
  download: Download,
  bell: Bell,
  "scroll-text": ScrollText,
  settings: Settings,
};

export default function NavIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name];
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={2} aria-hidden="true" />;
}
