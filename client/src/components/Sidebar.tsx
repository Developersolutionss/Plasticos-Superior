import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Menu, Wrench, Zap } from "lucide-react";
import "./Sidebar.css";
import NavIcon from "./NavIcon";
import { navSections, type NavChoice, type NavEntry, type NavLeaf } from "./navConfig";
import { useShortcuts } from "./useShortcuts";
import ShortcutsConfig from "./ShortcutsConfig";

function AtajoItem({ item }: { item: NavChoice }) {
  const to = item.to;
  if (item.disabled || !to) {
    return (
      <button className="sidebar-quick-item nav-item disabled" type="button" disabled title="Próximamente">
        <span className="ic">
          <NavIcon name={item.icon} size={16} />
        </span>
        <span className="hidden-when-collapsed">{item.label}</span>
      </button>
    );
  }
  return (
    <NavLink to={to} end className="sidebar-quick-item">
      <span className="ic">
        <NavIcon name={item.icon} size={16} />
      </span>
      <span className="hidden-when-collapsed">{item.label}</span>
    </NavLink>
  );
}

function SubmenuLeaf({ item }: { item: NavLeaf }) {
  if (item.disabled || !item.to) {
    return (
      <button className="submenu-item disabled" type="button" disabled>
        <span>{item.label}</span>
        <span className="soon-tag hidden-when-collapsed">Próximamente</span>
      </button>
    );
  }
  return (
    <NavLink to={item.to} end className={({ isActive }) => `submenu-item ${isActive ? "active" : ""}`}>
      {item.label}
    </NavLink>
  );
}

function NavSection({ entry }: { entry: NavEntry }) {
  const location = useLocation();
  const hasChildren = !!entry.children?.length;
  const childActive = entry.children?.some((c) => c.to && c.to === location.pathname);
  const [open, setOpen] = useState(!!childActive);

  if (!hasChildren) {
    if (entry.disabled || !entry.to) {
      return (
        <button className="nav-item disabled" type="button" disabled title="Próximamente">
          <span className="ic">
            <NavIcon name={entry.icon} />
          </span>
          <span className="hidden-when-collapsed">{entry.label}</span>
          <span className="soon-tag hidden-when-collapsed">Próximamente</span>
        </button>
      );
    }
    return (
      <NavLink to={entry.to} end className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
        <span className="ic">
          <NavIcon name={entry.icon} />
        </span>
        <span className="hidden-when-collapsed">{entry.label}</span>
      </NavLink>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`nav-item has-sub ${open ? "open" : ""} ${childActive ? "active" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ic">
          <NavIcon name={entry.icon} />
        </span>
        <span className="hidden-when-collapsed">{entry.label}</span>
        <span className="caret">▶</span>
      </button>
      <div className={`submenu ${open ? "open" : ""}`}>
        {entry.children?.map((child) => (
          <SubmenuLeaf key={child.id} item={child} />
        ))}
      </div>
    </>
  );
}

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { atajos } = useShortcuts();
  const [showConfig, setShowConfig] = useState(false);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">P</div>
        <span className="sidebar-brand hidden-when-collapsed">Plásticos Superior</span>
        <button className="sidebar-collapse-btn" type="button" onClick={onToggle} title="Colapsar menú">
          <Menu size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-quick-group">
          <div className="sidebar-quick-label">
            <Zap size={12} strokeWidth={2} className="sidebar-quick-label-icon" aria-hidden="true" /> Atajos
          </div>
          {atajos.length === 0 && (
            <div className="sidebar-empty hidden-when-collapsed">Ajustá tus atajos con el ícono de abajo</div>
          )}
          {atajos.map((item) => (
            <AtajoItem key={item.id} item={item} />
          ))}
        </div>

        <div className="sidebar-divider" />

        <nav className="sidebar-nav">
          {navSections.map((entry) => (
            <NavSection key={entry.id} entry={entry} />
          ))}
        </nav>

        <div className="sidebar-divider" />

        <button
          className="sidebar-adjust-btn"
          type="button"
          onClick={() => setShowConfig((v) => !v)}
          title="Ajustar atajos"
        >
          <span className="ic">
            <Wrench size={16} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="hidden-when-collapsed">Ajustar los Atajos</span>
        </button>
      </div>

      {showConfig && <ShortcutsConfig onClose={() => setShowConfig(false)} />}
    </aside>
  );
}
