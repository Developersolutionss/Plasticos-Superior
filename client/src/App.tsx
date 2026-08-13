import type { ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useAuth, type UserRole } from "./auth/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import InventoryDashboard from "./pages/InventoryDashboard";
import Dispatches from "./pages/Dispatches";
import ProductionUpload from "./pages/ProductionUpload";
import Clients from "./pages/Clients";
import Contactos from "./pages/Contactos";
import NuevoCliente from "./pages/NuevoCliente";
import OrdenesProduccion from "./pages/OrdenesProduccion";
import Planeacion from "./pages/Planeacion";
import Calidad from "./pages/Calidad";
import Trazabilidad from "./pages/Trazabilidad";
import Auditoria from "./pages/Auditoria";
import Almacen from "./pages/Almacen";
import Productos from "./pages/Productos";
import Usuarios from "./pages/Usuarios";
import UbicacionDetalle from "./pages/UbicacionDetalle";
import DashboardEjecutivo from "./pages/DashboardEjecutivo";
import Exportaciones from "./pages/Exportaciones";
import EstacionProduccion from "./pages/EstacionProduccion";
import Cotizaciones from "./pages/Cotizaciones";
import Pedidos from "./pages/Pedidos";
import Facturas from "./pages/Facturas";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import SecuritySettings from "./pages/SecuritySettings";
import {
  ADMIN,
  ALMACEN,
  VENTAS,
  PRODUCCION_GESTION,
  OP_EXTRUSION,
  OP_IMPRESION,
  OP_SELLADO,
  CALIDAD,
  AUDITORIA,
} from "./components/navConfig";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** Además de ocultarse en el menú, cada ruta valida el rol acá — así nadie
 * accede a un módulo ajeno tipeando la URL directamente. */
function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

const STATION_ROLES: Record<string, UserRole[]> = {
  extrusion: OP_EXTRUSION,
  impresion: OP_IMPRESION,
  sellado: OP_SELLADO,
  precorte: OP_SELLADO,
};

function RequireStationRole({ children }: { children: ReactNode }) {
  const { station } = useParams();
  const { user } = useAuth();
  const allowed = station ? STATION_ROLES[station] : undefined;
  if (!user || !allowed || !allowed.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      {/* Pública a propósito: el token es la credencial (ver publicLocation.ts). */}
      <Route path="/qr/:token" element={<UbicacionDetalle />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<InventoryDashboard />} />
        <Route
          path="despachos"
          element={
            <RequireRole roles={ALMACEN}>
              <Dispatches />
            </RequireRole>
          }
        />
        <Route
          path="produccion"
          element={
            <RequireRole roles={[...ALMACEN, ...PRODUCCION_GESTION]}>
              <ProductionUpload />
            </RequireRole>
          }
        />
        <Route
          path="clientes"
          element={
            <RequireRole roles={VENTAS}>
              <Clients />
            </RequireRole>
          }
        />
        <Route
          path="clientes/nuevo"
          element={
            <RequireRole roles={VENTAS}>
              <NuevoCliente />
            </RequireRole>
          }
        />
        <Route
          path="clientes/contactos"
          element={
            <RequireRole roles={VENTAS}>
              <Contactos />
            </RequireRole>
          }
        />
        <Route
          path="planeacion"
          element={
            <RequireRole roles={PRODUCCION_GESTION}>
              <Planeacion />
            </RequireRole>
          }
        />
        <Route
          path="calidad"
          element={
            <RequireRole roles={CALIDAD}>
              <Calidad />
            </RequireRole>
          }
        />
        <Route
          path="trazabilidad"
          element={
            <RequireRole roles={[...PRODUCCION_GESTION, ...CALIDAD, ...AUDITORIA]}>
              <Trazabilidad />
            </RequireRole>
          }
        />
        <Route
          path="auditoria"
          element={
            <RequireRole roles={AUDITORIA}>
              <Auditoria />
            </RequireRole>
          }
        />
        <Route
          path="almacen"
          element={
            <RequireRole roles={ALMACEN}>
              <Almacen />
            </RequireRole>
          }
        />
        <Route
          path="inventario/productos"
          element={
            <RequireRole roles={PRODUCCION_GESTION}>
              <Productos />
            </RequireRole>
          }
        />
        <Route
          path="dashboard-ejecutivo"
          element={
            <RequireRole roles={ADMIN}>
              <DashboardEjecutivo />
            </RequireRole>
          }
        />
        <Route
          path="exportaciones"
          element={
            <RequireRole roles={ADMIN}>
              <Exportaciones />
            </RequireRole>
          }
        />
        <Route
          path="produccion/ordenes"
          element={
            <RequireRole roles={PRODUCCION_GESTION}>
              <OrdenesProduccion />
            </RequireRole>
          }
        />
        <Route
          path="produccion/estacion/:station"
          element={
            <RequireStationRole>
              <EstacionProduccion />
            </RequireStationRole>
          }
        />
        <Route
          path="clientes/cotizaciones"
          element={
            <RequireRole roles={VENTAS}>
              <Cotizaciones />
            </RequireRole>
          }
        />
        <Route
          path="pedidos"
          element={
            <RequireRole roles={VENTAS}>
              <Pedidos />
            </RequireRole>
          }
        />
        <Route
          path="facturas"
          element={
            <RequireRole roles={VENTAS}>
              <Facturas />
            </RequireRole>
          }
        />
        <Route
          path="configuracion/autenticacion"
          element={
            <RequireRole roles={ADMIN}>
              <SecuritySettings />
            </RequireRole>
          }
        />
        <Route
          path="configuracion/usuarios"
          element={
            <RequireRole roles={ADMIN}>
              <Usuarios />
            </RequireRole>
          }
        />
      </Route>
    </Routes>
  );
}
