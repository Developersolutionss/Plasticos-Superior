import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import ClienteForm from "../components/ClienteForm";

/** Página dedicada a registrar un cliente nuevo (también la PFP). */
export default function NuevoCliente() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Crear cliente</h1>
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-5">
        <ClienteForm
          onSaved={(client) => {
            queryClient.invalidateQueries({ queryKey: ["clients"] });
            navigate("/clientes", { state: { selectedClientId: client.id } });
          }}
          onCancel={() => navigate("/clientes")}
        />
      </div>
    </div>
  );
}