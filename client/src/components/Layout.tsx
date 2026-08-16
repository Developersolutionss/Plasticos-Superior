import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import Sidebar from "./Sidebar";
import NotificationBell from "./NotificationBell";
import ThemeToggle from "./ThemeToggle";

export default function Layout() {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  // El cajón móvil se cierra solo al navegar a otra pantalla.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex flex-col min-h-screen dark:bg-slate-950">
        <header className="bg-white dark:bg-slate-900 dark:border-slate-800 border-b px-4 sm:px-6 py-3 flex items-center justify-between sm:justify-end gap-4">
          <button
            type="button"
            className="md:hidden text-slate-600 dark:text-slate-400 p-1 -ml-1"
            onClick={() => setMobileOpen(true)}
            title="Abrir menú"
          >
            <Menu size={20} strokeWidth={2} aria-hidden="true" />
          </button>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <NotificationBell />
            <span className="text-sm text-slate-600 dark:text-slate-300">{user?.name}</span>
            <button onClick={logout} className="text-sm text-slate-500 dark:text-slate-400 underline">
              Salir
            </button>
          </div>
        </header>
        <main className="app-content flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
