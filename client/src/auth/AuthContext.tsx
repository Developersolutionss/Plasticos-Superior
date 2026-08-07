import { createContext, ReactNode, useContext, useState } from "react";

export type UserRole =
  | "super_admin"
  | "admin"
  | "gerente_produccion"
  | "planeacion"
  | "ventas_pedidos"
  | "operario_extrusion"
  | "operario_impresion"
  | "operario_sellado_precorte"
  | "calidad"
  | "almacen_despachos"
  | "auditor";

interface AuthUser {
  id: number;
  name: string;
  role: UserRole;
  email: string;
  twoFactorEnabled?: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

  function login(token: string, user: AuthUser) {
    localStorage.setItem("token", token);
    localStorage.setItem("user", JSON.stringify(user));
    setUser(user);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
