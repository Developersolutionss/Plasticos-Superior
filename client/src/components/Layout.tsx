import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const navItems = [
  { to: "/", label: "Inventario" },
  { to: "/despachos", label: "Despachos" },
  { to: "/produccion", label: "Carga de Producción" },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
        <span className="font-semibold">Inventario y Despachos</span>
        <div className="flex items-center gap-4 text-sm">
          <span>{user?.name}</span>
          <button onClick={logout} className="underline">
            Salir
          </button>
        </div>
      </header>
      <nav className="bg-slate-800 text-slate-200 px-4 flex gap-4 text-sm">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) => `py-2 border-b-2 ${isActive ? "border-white text-white" : "border-transparent"}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="p-4">
        <Outlet />
      </main>
    </div>
  );
}
