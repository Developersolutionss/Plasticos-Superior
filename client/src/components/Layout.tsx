import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import Sidebar from "./Sidebar";

export default function Layout() {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`app-shell ${collapsed ? "collapsed" : ""}`}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <div className="flex flex-col min-h-screen">
        <header className="bg-white border-b px-6 py-3 flex items-center justify-end gap-4">
          <span className="text-sm text-slate-600">{user?.name}</span>
          <button onClick={logout} className="text-sm text-slate-500 underline">
            Salir
          </button>
        </header>
        <main className="app-content flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
