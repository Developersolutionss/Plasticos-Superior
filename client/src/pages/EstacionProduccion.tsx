import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ScanLine } from "lucide-react";
import { api } from "../api/client";
import BarcodeScanner from "../components/BarcodeScanner";
import { STATION_LABELS, OpStation, OPEN_STATUSES } from "../opTemplates";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  pendiente_calidad: "Pendiente de calidad",
  detenida: "Detenida",
  finalizada: "Terminada",
  cancelada: "Cancelada",
};

/**
 * Cola de la estación: las OPs de ESTE proceso, con las abiertas primero.
 * El trabajo real (cargar rollos, cerrar) pasa en la hoja de cada OP
 * (/produccion/ordenes/:id) — esta pantalla es el punto de entrada del
 * operario, con escáner QR para saltar directo a una OP.
 */
export default function EstacionProduccion() {
  const { station } = useParams<{ station: string }>();
  const label = STATION_LABELS[station as OpStation];
  const navigate = useNavigate();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["productionOrders", "station", station],
    queryFn: () => api.getProductionOrders({ station }),
    enabled: !!label,
  });

  if (!label) {
    return <p className="text-red-600 dark:text-red-400">Estación desconocida.</p>;
  }

  const open = orders?.filter((o: any) => OPEN_STATUSES.includes(o.status)) ?? [];
  const closed = orders?.filter((o: any) => !OPEN_STATUSES.includes(o.status)) ?? [];

  function handleScannedOrder(orderNumber: string) {
    setScanning(false);
    const match = orders?.find((o: any) => o.orderNumber === orderNumber);
    if (!match) {
      setError(`No se encontró ninguna OP de ${label} con número "${orderNumber}".`);
      return;
    }
    setError(null);
    navigate(`/produccion/ordenes/${match.id}`);
  }

  function kilosProducidos(order: any) {
    return (order.rolls ?? []).reduce((acc: number, r: any) => acc + Number(r.weightKg), 0);
  }

  function OrderCard({ order }: { order: any }) {
    return (
      <Link
        to={`/produccion/ordenes/${order.id}`}
        className="block px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-slate-800 dark:text-slate-100">{order.orderNumber}</span>
          <span className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{STATUS_LABELS[order.status]}</span>
        </div>
        <p className="text-slate-600 dark:text-slate-300">
          {order.product.name}
          {order.client?.name ? ` · ${order.client.name}` : ""}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {kilosProducidos(order)} / {Number(order.quantityPlanned)} {order.product.unit} · {order.rolls?.length ?? 0} rollos
        </p>
      </Link>
    );
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{label}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Órdenes de producción de esta estación</p>
        </div>
        <button
          type="button"
          className="bg-slate-800 text-white text-sm px-3 py-2 rounded inline-flex items-center gap-1.5 hover:bg-slate-700"
          onClick={() => {
            setError(null);
            setScanning(true);
          }}
        >
          <ScanLine size={16} strokeWidth={2} aria-hidden="true" /> Escanear OP
        </button>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
      {isLoading && <p className="text-slate-500 dark:text-slate-400 text-sm">Cargando...</p>}

      {!isLoading && (
        <>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
            <p className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
              Abiertas ({open.length})
            </p>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {open.map((o: any) => (
                <OrderCard key={o.id} order={o} />
              ))}
              {open.length === 0 && <p className="px-5 py-4 text-sm text-slate-500 dark:text-slate-400">No hay OPs abiertas de {label}.</p>}
            </div>
          </div>

          {closed.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <p className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
                Cerradas ({closed.length})
              </p>
              <div className="divide-y divide-slate-100 dark:divide-slate-700">
                {closed.slice(0, 10).map((o: any) => (
                  <OrderCard key={o.id} order={o} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {scanning && <BarcodeScanner title="Escanear OP" onDetected={handleScannedOrder} onClose={() => setScanning(false)} />}
    </div>
  );
}
