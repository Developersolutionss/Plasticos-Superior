import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, MapPin, QrCode, X } from "lucide-react";
import { api } from "../api/client";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full border border-slate-300 rounded-md px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500";

export default function Almacen() {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  const [qrLocationId, setQrLocationId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: locations } = useQuery({ queryKey: ["warehouseLocations"], queryFn: api.getWarehouseLocations });
  const { data: stock, isLoading } = useQuery({ queryKey: ["warehouseStock"], queryFn: api.getWarehouseStock });

  async function handleCreateLocation(e: FormEvent) {
    e.preventDefault();
    setLocationError(null);
    try {
      await api.createWarehouseLocation({ code, label });
      setCode("");
      setLabel("");
      queryClient.invalidateQueries({ queryKey: ["warehouseLocations"] });
    } catch {
      setLocationError("No se pudo crear la ubicación (¿código repetido?)");
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Almacén / WMS</h1>
        <p className="text-sm text-slate-500">Ubicaciones físicas de bodega y qué cantidad de cada producto hay en cada una</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ubicaciones</h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {locations?.map((loc: any) => (
              <div
                key={loc.id}
                className="flex items-center gap-2 border border-slate-200 rounded-md pl-3 pr-1.5 py-1.5 text-sm"
              >
                <MapPin size={14} strokeWidth={2} className="text-slate-400" aria-hidden="true" />
                <span className="font-medium text-slate-800">{loc.code}</span>
                <span className="text-slate-500">— {loc.label}</span>
                <button
                  type="button"
                  className="ml-1 p-1 rounded hover:bg-slate-100 text-slate-500"
                  title="Ver QR"
                  onClick={() => setQrLocationId(loc.id)}
                >
                  <QrCode size={16} strokeWidth={2} />
                </button>
              </div>
            ))}
            {locations?.length === 0 && <p className="text-slate-500 text-sm">Todavía no hay ubicaciones.</p>}
          </div>

          <form onSubmit={handleCreateLocation} className="border-t border-slate-100 pt-4">
            {locationError && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-red-50 text-red-700 text-sm">
                <CircleAlert size={16} strokeWidth={2} aria-hidden="true" />
                <span>{locationError}</span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-[9rem_1fr_auto] gap-3 items-end">
              <Field label="Código">
                <input className={inputClass} placeholder="Ej. A-3" value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Field label="Nombre">
                <input
                  className={inputClass}
                  placeholder="Ej. Bodega A - Estante 3"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </Field>
              <button
                className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
                type="submit"
              >
                Crear ubicación
              </button>
            </div>
          </form>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock por producto</h2>
        </div>
        {isLoading && <p className="p-4 text-center text-slate-500 text-sm">Cargando...</p>}
        {!isLoading && stock?.length === 0 && <p className="p-4 text-center text-slate-500 text-sm">No hay productos.</p>}

        {!isLoading && stock && stock.length > 0 && (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="p-3 w-8"></th>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Stock total</th>
                  <th className="p-3">Sin ubicar</th>
                </tr>
              </thead>
              <tbody>
                {stock.map((p: any) => (
                  <ProductRow
                    key={p.productId}
                    product={p}
                    locations={locations ?? []}
                    expanded={expandedProductId === p.productId}
                    onToggle={() => setExpandedProductId(expandedProductId === p.productId ? null : p.productId)}
                  />
                ))}
              </tbody>
            </table>

            <div className="md:hidden divide-y divide-slate-100">
              {stock.map((p: any) => (
                <ProductCard
                  key={p.productId}
                  product={p}
                  locations={locations ?? []}
                  expanded={expandedProductId === p.productId}
                  onToggle={() => setExpandedProductId(expandedProductId === p.productId ? null : p.productId)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {qrLocationId !== null && <QrModal locationId={qrLocationId} onClose={() => setQrLocationId(null)} />}
    </div>
  );
}

function QrModal({ locationId, onClose }: { locationId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["warehouseLocationQr", locationId],
    queryFn: () => api.getWarehouseLocationQr(locationId),
  });

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-lg p-6 max-w-xs w-full text-center space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Código QR de la ubicación</p>
          <button type="button" className="p-1 rounded hover:bg-slate-100 text-slate-500" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        {isLoading && <p className="text-slate-500 text-sm py-8">Generando...</p>}
        {data && (
          <>
            <img src={data.dataUrl} alt="Código QR de la ubicación" className="mx-auto w-56 h-56" />
            <p className="text-xs text-slate-400 break-all">{data.url}</p>
            <p className="text-xs text-slate-500">
              Imprimí este QR y pegalo en el estante. Al escanearlo con la cámara del celular se abre el stock de esta
              ubicación en tiempo real.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Lista de ubicaciones del producto + formulario de asignar/mover.
 * Compartido entre la fila expandida de la tabla (desktop) y la tarjeta
 * expandida (móvil) para no duplicar la lógica de asignación. */
function AssignForm({ product, locations }: { product: any; locations: any[] }) {
  const [toLocationId, setToLocationId] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  async function handleAssign(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!toLocationId || !quantity) return;
    try {
      await api.assignWarehouseStock({
        productId: product.productId,
        toLocationId: Number(toLocationId),
        quantity: Number(quantity),
        fromLocationId: fromLocationId ? Number(fromLocationId) : undefined,
      });
      setQuantity("");
      setFromLocationId("");
      queryClient.invalidateQueries({ queryKey: ["warehouseStock"] });
    } catch {
      setError("No se pudo asignar (¿alcanza la cantidad en la ubicación de origen?)");
    }
  }

  return (
    <div className="space-y-4">
      <ul className="text-sm space-y-1.5">
        {product.locations.map((loc: any) => (
          <li key={loc.locationId} className="flex justify-between">
            <span className="text-slate-600">
              {loc.code} — {loc.label}
            </span>
            <span className="font-medium text-slate-800">
              {loc.quantity} {product.unit}
            </span>
          </li>
        ))}
        {product.locations.length === 0 && <li className="text-slate-500">Sin ubicaciones asignadas todavía.</li>}
      </ul>

      <form onSubmit={handleAssign} className="border-t border-slate-200 pt-3 space-y-2">
        {error && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-50 text-red-700 text-xs">
            <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_8rem_auto] gap-2 items-end">
          <Field label="Desde">
            <select className={inputClass} value={fromLocationId} onChange={(e) => setFromLocationId(e.target.value)}>
              <option value="">Sin ubicar</option>
              {product.locations.map((loc: any) => (
                <option key={loc.locationId} value={loc.locationId}>
                  {loc.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hacia">
            <select className={inputClass} value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
              <option value="">Elegir...</option>
              {locations.map((loc: any) => (
                <option key={loc.id} value={loc.id}>
                  {loc.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cantidad">
            <input
              className={inputClass}
              placeholder="0.00"
              type="number"
              step="0.01"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <button
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
            type="submit"
          >
            Asignar
          </button>
        </div>
      </form>
    </div>
  );
}

function ProductRow({
  product,
  locations,
  expanded,
  onToggle,
}: {
  product: any;
  locations: any[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t border-slate-100 cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td className="p-3 text-slate-400">
          {expanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
        </td>
        <td className="p-3">
          {product.name} <span className="text-slate-400">({product.sku})</span>
        </td>
        <td className="p-3">
          {product.totalStock} {product.unit}
        </td>
        <td className={`p-3 ${product.unassigned > 0 ? "text-amber-700 font-medium" : "text-slate-500"}`}>
          {product.unassigned} {product.unit}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td></td>
          <td colSpan={3} className="p-4">
            <AssignForm product={product} locations={locations} />
          </td>
        </tr>
      )}
    </>
  );
}

function ProductCard({
  product,
  locations,
  expanded,
  onToggle,
}: {
  product: any;
  locations: any[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button type="button" className="w-full text-left p-4 space-y-1" onClick={onToggle}>
        <div className="flex items-center justify-between">
          <p className="font-medium text-slate-800">
            {product.name} <span className="text-slate-400 font-normal">({product.sku})</span>
          </p>
          {expanded ? (
            <ChevronDown size={16} strokeWidth={2} className="text-slate-400 shrink-0" />
          ) : (
            <ChevronRight size={16} strokeWidth={2} className="text-slate-400 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">
            Stock: {product.totalStock} {product.unit}
          </span>
          <span className={product.unassigned > 0 ? "text-amber-700 font-medium" : "text-slate-500"}>
            Sin ubicar: {product.unassigned} {product.unit}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 bg-slate-50">
          <AssignForm product={product} locations={locations} />
        </div>
      )}
    </div>
  );
}
