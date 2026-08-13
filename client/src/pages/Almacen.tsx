import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../api/client";

export default function Almacen() {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
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
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Almacén / WMS</h1>
        <p className="text-sm text-slate-500">Ubicaciones físicas de bodega y qué cantidad de cada producto hay en cada una</p>
      </div>

      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700">Ubicaciones</p>
        {locationError && <p className="text-red-600 text-sm">{locationError}</p>}
        <div className="flex flex-wrap gap-2">
          {locations?.map((loc: any) => (
            <span key={loc.id} className="text-xs bg-slate-100 text-slate-700 rounded-full px-3 py-1">
              <span className="font-medium">{loc.code}</span> — {loc.label}
            </span>
          ))}
          {locations?.length === 0 && <p className="text-slate-500 text-sm">Todavía no hay ubicaciones.</p>}
        </div>
        <form onSubmit={handleCreateLocation} className="flex flex-wrap gap-2 pt-2 border-t">
          <input
            className="border rounded px-3 py-2 text-sm w-28"
            placeholder="Código (ej. A-3)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <input
            className="border rounded px-3 py-2 text-sm flex-1 min-w-[12rem]"
            placeholder="Nombre (ej. Bodega A - Estante 3)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
            Crear ubicación
          </button>
        </form>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="p-3 w-8"></th>
              <th className="p-3">Producto</th>
              <th className="p-3">Stock total</th>
              <th className="p-3">Sin ubicar</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-slate-500">
                  Cargando...
                </td>
              </tr>
            )}
            {stock?.map((p: any) => (
              <ProductRow
                key={p.productId}
                product={p}
                locations={locations ?? []}
                expanded={expandedProductId === p.productId}
                onToggle={() => setExpandedProductId(expandedProductId === p.productId ? null : p.productId)}
              />
            ))}
            {stock?.length === 0 && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-slate-500">
                  No hay productos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    <>
      <tr className="border-t cursor-pointer hover:bg-slate-50" onClick={onToggle}>
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
        <tr className="border-t bg-slate-50">
          <td></td>
          <td colSpan={3} className="p-3 space-y-3">
            <ul className="text-sm space-y-1">
              {product.locations.map((loc: any) => (
                <li key={loc.locationId} className="flex justify-between">
                  <span>
                    {loc.code} — {loc.label}
                  </span>
                  <span className="font-medium">
                    {loc.quantity} {product.unit}
                  </span>
                </li>
              ))}
              {product.locations.length === 0 && <li className="text-slate-500">Sin ubicaciones asignadas todavía.</li>}
            </ul>

            {error && <p className="text-red-600 text-xs">{error}</p>}
            <form onSubmit={handleAssign} className="flex flex-wrap items-center gap-2">
              <select
                className="border rounded px-2 py-1.5 text-xs"
                value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)}
              >
                <option value="">Desde: sin ubicar</option>
                {product.locations.map((loc: any) => (
                  <option key={loc.locationId} value={loc.locationId}>
                    Desde: {loc.code}
                  </option>
                ))}
              </select>
              <select
                className="border rounded px-2 py-1.5 text-xs"
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
              >
                <option value="">Hacia...</option>
                {locations.map((loc: any) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.code}
                  </option>
                ))}
              </select>
              <input
                className="border rounded px-2 py-1.5 text-xs w-24"
                placeholder="Cantidad"
                type="number"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <button className="bg-slate-800 text-white text-xs px-3 py-1.5 rounded" type="submit">
                Asignar
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
