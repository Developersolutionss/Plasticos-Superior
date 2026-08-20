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
import OrdenProduccionDetalle from "./pages/OrdenProduccionDetalle";
import Planeacion from "./pages/Planeacion";
import Calidad from "./pages/Calidad";
import Trazabilidad from "./pages/Trazabilidad";
import Auditoria from "./pages/Auditoria";
import Almacen from "./pages/Almacen";
import Productos from "./pages/Productos";
import MateriaPrima from "./pages/MateriaPrima";
import Usuarios from "./pages/Usuarios";
import Movimientos from "./pages/Movimientos";
import UbicacionDetalle from "./pages/UbicacionDetalle";
import DashboardEjecutivo from "./pages/DashboardEjecutivo";
import DashboardIndicadores from "./pages/DashboardIndicadores";
import Notificaciones from "./pages/Notificaciones";
import Exportaciones from "./pages/Exportaciones";
import EstacionProduccion from "./pages/EstacionProduccion";
import Cotizaciones from "./pages/Cotizaciones";
import Pedidos from "./pages/Pedidos";
import Facturas from "./pages/Facturas";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import SecuritySettings from "./pages/SecuritySettings";
import Apariencia from "./pages/Apariencia";
import {
  ADMIN,
  ALMACEN,
  VENTAS,
  PRODUCCION_GESTION,
  OPERARIOS,
  OP_EXTRUSION,
  OP_IMPRESION,
  OP_SELLADO,
  CALIDAD,
  AUDITORIA,
  INVENTARIO,
} from "./components/navConfig";

/** La hoja de una OP la ven todos los que participan del ciclo: operarios y
 * gestión (cargan rollos / editan), Calidad (revisa) y Auditoría (traza). */
const OP_DETALLE: UserRole[] = [...new Set([...OPERARIOS, ...CALIDAD, ...AUDITORIA])];

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** A dónde manda "/" a un rol que no ve Existencias (INVENTARIO) — su
 * pantalla de trabajo habitual, para no dejarlo varado en una página vacía
 * ni mostrarle el inventario completo solo por estar logueado. */
const DEFAULT_ROUTE_FOR_ROLE: Partial<Record<UserRole, string>> = {
  operario_extrusion: "/produccion/estacion/extrusion",
  operario_impresion: "/produccion/estacion/impresion",
  operario_sellado_precorte: "/produccion/estacion/sellado",
  calidad: "/calidad",
  auditor: "/auditoria",
};

/** Índice ("/"): Existencias para quien puede verlas (ver ROLES.INVENTARIO
 * en el backend, mismo criterio acá); el resto va a su pantalla habitual. */
function IndexRoute() {
  const { user } = useAuth();
  if (user && !(INVENTARIO as UserRole[]).includes(user.role)) {
    const to = DEFAULT_ROUTE_FOR_ROLE[user.role];
    if (to) return <Navigate to={to} replace />;
  }
  return <InventoryDashboard />;
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
        <Route index element={<IndexRoute />} />
        <Route path="notificaciones" element={<Notificaciones />} />
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
          path="inventario/movimientos"
          element={
            <RequireRole roles={ALMACEN}>
              <Movimientos />
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
          path="inventario/materia-prima"
          element={
            <RequireRole roles={PRODUCCION_GESTION}>
              <MateriaPrima />
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
          path="dashboard-indicadores"
          element={
            <RequireRole roles={ADMIN}>
              <DashboardIndicadores />
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
          path="produccion/ordenes/:id"
          element={
            <RequireRole roles={OP_DETALLE}>
              <OrdenProduccionDetalle />
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
        {/* Oculto a pedido de Steban: el cliente factura aparte. Módulo
            queda creado (componente Facturas y backend intactos) por si
            se necesita reactivar más adelante — no descomentar sin
            confirmar primero.
        <Route
          path="facturas"
          element={
            <RequireRole roles={VENTAS}>
              <Facturas />
            </RequireRole>
          }
        /> */}
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
        {/* Sin RequireRole a propósito: es una preferencia personal, no algo que restringir por rol. */}
        <Route path="configuracion/apariencia" element={<Apariencia />} />
      </Route>
    </Routes>
  );
}
