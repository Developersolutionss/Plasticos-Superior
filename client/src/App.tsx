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

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
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
      </Route>
    </Routes>
  );
}
