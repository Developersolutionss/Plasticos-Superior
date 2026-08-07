import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import InventoryDashboard from "./pages/InventoryDashboard";
import Dispatches from "./pages/Dispatches";
import ProductionUpload from "./pages/ProductionUpload";
import Clients from "./pages/Clients";
import OrdenesProduccion from "./pages/OrdenesProduccion";
import EstacionProduccion from "./pages/EstacionProduccion";
import Cotizaciones from "./pages/Cotizaciones";
import Pedidos from "./pages/Pedidos";
import Facturas from "./pages/Facturas";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import SecuritySettings from "./pages/SecuritySettings";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<InventoryDashboard />} />
        <Route path="despachos" element={<Dispatches />} />
        <Route path="produccion" element={<ProductionUpload />} />
        <Route path="clientes" element={<Clients />} />
        <Route path="clientes/nuevo" element={<Clients />} />
        <Route path="clientes/contactos" element={<Clients />} />
        <Route path="produccion/ordenes" element={<OrdenesProduccion />} />
        <Route path="produccion/estacion/:station" element={<EstacionProduccion />} />
        <Route path="clientes/cotizaciones" element={<Cotizaciones />} />
        <Route path="pedidos" element={<Pedidos />} />
        <Route path="facturas" element={<Facturas />} />
        <Route path="configuracion/autenticacion" element={<SecuritySettings />} />
      </Route>
    </Routes>
  );
}
