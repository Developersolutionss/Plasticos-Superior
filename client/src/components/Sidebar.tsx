import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import "./Sidebar.css";
import { favorites, navSections, quickActions, type NavEntry, type NavLeaf } from "./navConfig";

function QuickItem({ item }: { item: NavLeaf }) {
  if (item.disabled || !item.to) {
    return (
      <button className="sidebar-quick-item nav-item disabled" type="button" disabled title="Próximamente">
        <span className="ic">•</span>
        <span className="hidden-when-collapsed">{item.label}</span>
      </button>
    );
  }
  return (
    <NavLink to={item.to} end className="sidebar-quick-item">
      <span className="ic">•</span>
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
          <span className="ic">{entry.icon}</span>
          <span className="hidden-when-collapsed">{entry.label}</span>
          <span className="soon-tag hidden-when-collapsed">Próximamente</span>
        </button>
      );
    }
    return (
      <NavLink to={entry.to} end className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
        <span className="ic">{entry.icon}</span>
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
        <span className="ic">{entry.icon}</span>
        <span className="hidden-when-collapsed">{entry.label}</span>
        <span className="caret">▶</span>
      </button>
      <div className={`submenu ${open ? "open" : ""}`}>
        {entry.children!.map((child) => (
          <SubmenuLeaf key={child.label} item={child} />
        ))}
      </div>
    </>
  );
}

export default function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">P</div>
        <span className="sidebar-brand hidden-when-collapsed">Plásticos Superior</span>
        <button className="sidebar-collapse-btn" type="button" onClick={onToggle} title="Colapsar menú">
          ☰
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-quick-group">
          <div className="sidebar-quick-label">Acciones rápidas</div>
          {quickActions.map((item) => (
            <QuickItem key={item.label} item={item} />
          ))}
          <div className="sidebar-quick-label">Favoritos</div>
          {favorites.map((item) => (
            <QuickItem key={item.label} item={item} />
          ))}
        </div>

        <div className="sidebar-divider" />

        <nav className="sidebar-nav">
          {navSections.map((entry) => (
            <NavSection key={entry.label} entry={entry} />
          ))}
        </nav>
      </div>
    </aside>
  );
}
