import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, ReactNode, useState } from "react";
import { ChevronDown, ChevronRight, CircleAlert, MapPin, QrCode, ScanLine, X } from "lucide-react";
import { api } from "../api/client";
import BarcodeScanner from "../components/BarcodeScanner";

/** El QR de ubicación codifica una URL pública (.../qr/:token) — acá se
 * extrae el token, tanto si se escaneó esa URL completa como si (por las
 * dudas) se escaneó un token suelto. */
function extractLocationToken(scanned: string): string {
  const parts = scanned.split("/").filter(Boolean);
  return parts[parts.length - 1];
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "w-full border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 focus:border-slate-500";

export default function Almacen() {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null);
  const [qrLocationId, setQrLocationId] = useState<number | null>(null);
  const [scanningProduct, setScanningProduct] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: locations } = useQuery({ queryKey: ["warehouseLocations"], queryFn: api.getWarehouseLocations });
  const { data: stock, isLoading } = useQuery({ queryKey: ["warehouseStock"], queryFn: api.getWarehouseStock });

  function handleScannedProduct(sku: string) {
    setScanningProduct(false);
    const match = stock?.find((p: any) => p.sku === sku);
    if (!match) {
      setScanError(`No se encontró ningún producto con SKU "${sku}".`);
      return;
    }
    setScanError(null);
    setExpandedProductId(match.productId);
  }

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
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Almacén / WMS</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Ubicaciones físicas de bodega y qué cantidad de cada producto hay en cada una</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ubicaciones</h2>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {locations?.map((loc: any) => (
              <div
                key={loc.id}
                className="flex items-center gap-2 border border-slate-200 dark:border-slate-700 rounded-md pl-3 pr-1.5 py-1.5 text-sm"
              >
                <MapPin size={14} strokeWidth={2} className="text-slate-400 dark:text-slate-400" aria-hidden="true" />
                <span className="font-medium text-slate-800 dark:text-slate-100">{loc.code}</span>
                <span className="text-slate-500 dark:text-slate-400">— {loc.label}</span>
                <button
                  type="button"
                  className="ml-1 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                  title="Ver QR"
                  onClick={() => setQrLocationId(loc.id)}
                >
                  <QrCode size={16} strokeWidth={2} />
                </button>
              </div>
            ))}
            {locations?.length === 0 && <p className="text-slate-500 dark:text-slate-400 text-sm">Todavía no hay ubicaciones.</p>}
          </div>

          <form onSubmit={handleCreateLocation} className="border-t border-slate-100 dark:border-slate-700 pt-4">
            {locationError && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 text-sm">
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

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Stock por producto</h2>
          <button
            type="button"
            className="text-slate-600 dark:text-slate-300 text-xs border border-slate-300 dark:border-slate-600 rounded-md px-2.5 py-1.5 inline-flex items-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => {
              setScanError(null);
              setScanningProduct(true);
            }}
          >
            <ScanLine size={14} strokeWidth={2} aria-hidden="true" /> Escanear producto
          </button>
        </div>
        {scanError && <p className="px-5 pt-3 text-red-600 dark:text-red-400 text-xs">{scanError}</p>}
        {isLoading && <p className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</p>}
        {!isLoading && stock?.length === 0 && <p className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">No hay productos.</p>}

        {!isLoading && stock && stock.length > 0 && (
          <>
            <table className="hidden md:table w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-left text-slate-500 dark:text-slate-400">
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

            <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-700">
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
      {scanningProduct && (
        <BarcodeScanner title="Escanear producto" onDetected={handleScannedProduct} onClose={() => setScanningProduct(false)} />
      )}
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
        className="bg-white dark:bg-slate-900 rounded-xl shadow-lg p-6 max-w-xs w-full text-center space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Código QR de la ubicación</p>
          <button type="button" className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400" onClick={onClose}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        {isLoading && <p className="text-slate-500 dark:text-slate-400 text-sm py-8">Generando...</p>}
        {data && (
          <>
            <img src={data.dataUrl} alt="Código QR de la ubicación" className="mx-auto w-56 h-56" />
            <p className="text-xs text-slate-400 dark:text-slate-400 break-all">{data.url}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
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
  const [scanningLocation, setScanningLocation] = useState(false);
  const queryClient = useQueryClient();

  async function handleScannedLocation(scanned: string) {
    setScanningLocation(false);
    try {
      const location = await api.getWarehouseLocationByToken(extractLocationToken(scanned));
      setError(null);
      setToLocationId(String(location.id));
    } catch {
      setError("No se pudo reconocer el QR escaneado como una ubicación válida.");
    }
  }

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
            <span className="text-slate-600 dark:text-slate-300">
              {loc.code} — {loc.label}
            </span>
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {loc.quantity} {product.unit}
            </span>
          </li>
        ))}
        {product.locations.length === 0 && <li className="text-slate-500 dark:text-slate-400">Sin ubicaciones asignadas todavía.</li>}
      </ul>

      <form onSubmit={handleAssign} className="border-t border-slate-200 dark:border-slate-700 pt-3 space-y-2">
        {error && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 text-xs">
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
            <div className="flex gap-1.5">
              <select className={inputClass} value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                <option value="">Elegir...</option>
                {locations.map((loc: any) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.code}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="shrink-0 border border-slate-300 dark:border-slate-600 rounded-md px-2.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                title="Escanear QR de la ubicación"
                onClick={() => setScanningLocation(true)}
              >
                <ScanLine size={14} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
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

      {scanningLocation && (
        <BarcodeScanner
          title="Escanear QR de ubicación"
          onDetected={handleScannedLocation}
          onClose={() => setScanningLocation(false)}
        />
      )}
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
      <tr className="border-t border-slate-100 dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800" onClick={onToggle}>
        <td className="p-3 text-slate-400 dark:text-slate-400">
          {expanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
        </td>
        <td className="p-3">
          {product.name} <span className="text-slate-400 dark:text-slate-400">({product.sku})</span>
        </td>
        <td className="p-3">
          {product.totalStock} {product.unit}
        </td>
        <td className={`p-3 ${product.unassigned > 0 ? "text-amber-700 dark:text-amber-400 font-medium" : "text-slate-500 dark:text-slate-400"}`}>
          {product.unassigned} {product.unit}
        </td>
      </tr>
      {expanded && (
        <tr className="border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
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
          <p className="font-medium text-slate-800 dark:text-slate-100">
            {product.name} <span className="text-slate-400 dark:text-slate-400 font-normal">({product.sku})</span>
          </p>
          {expanded ? (
            <ChevronDown size={16} strokeWidth={2} className="text-slate-400 dark:text-slate-400 shrink-0" />
          ) : (
            <ChevronRight size={16} strokeWidth={2} className="text-slate-400 dark:text-slate-400 shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500 dark:text-slate-400">
            Stock: {product.totalStock} {product.unit}
          </span>
          <span className={product.unassigned > 0 ? "text-amber-700 dark:text-amber-400 font-medium" : "text-slate-500 dark:text-slate-400"}>
            Sin ubicar: {product.unassigned} {product.unit}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 bg-slate-50 dark:bg-slate-800">
          <AssignForm product={product} locations={locations} />
        </div>
      )}
    </div>
  );
}
