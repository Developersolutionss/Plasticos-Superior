import { FormEvent, useState } from "react";
import { api } from "../api/client";

interface ProductoFormProps {
  /** Producto a editar. Si viene `null`/`undefined`, el formulario crea uno nuevo. */
  product?: any;
  onSaved: (product: any) => void;
  onCancel?: () => void;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: "bultos", label: "Bultos" },
  { value: "rollos_prec_lam", label: "Rollos Precintado/Laminado" },
  { value: "rollos_fuelle", label: "Rollos Fuelle" },
  { value: "mangueta", label: "Mangueta" },
  { value: "tiras", label: "Tiras" },
  { value: "control_impresion", label: "Control Impresión" },
  { value: "tubular", label: "Tubular" },
  { value: "semitubular", label: "Semi tubular" },
  { value: "laminado", label: "Laminado" },
];

const UNITS: { value: string; label: string }[] = [
  { value: "kg", label: "Kilogramos (kg)" },
  { value: "unidad", label: "Unidad" },
];

const MEDIDA_UNIDADES = ["Pulgadas", "Cms."];
const DENSIDADES = ["ALTA", "BAJA"];
const COLORES = ["Negro", "Transparente", "Blanco", "Rojo", "Verde", "Verde claro"];

/** Formulario único para crear y editar productos. Se usa como modal desde
 * la pantalla de gestión de Inventario → Productos.
 *
 * El "SKU" (código interno tipo "BUL-002") dejó de pedirse acá: el cliente
 * no entendía qué era ni qué tenía que escribir ahí — ahora el sistema lo
 * genera solo a partir de la categoría (ver server/src/routes/products.ts,
 * nextSku()) y solo se muestra como referencia una vez creado el producto. */
export default function ProductoForm({ product, onSaved, onCancel }: ProductoFormProps) {
  const isEdit = Boolean(product);

  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? CATEGORIES[0].value);
  const [measure, setMeasure] = useState(product?.measure ?? "");
  const [measureUnit, setMeasureUnit] = useState(product?.measureUnit ?? "");
  const [talla, setTalla] = useState(product?.talla ?? "");
  const [color, setColor] = useState(product?.color ?? "");
  const [densidad, setDensidad] = useState(product?.densidad ?? "");
  const [medidaRef, setMedidaRef] = useState(product?.medidaRef ?? "");
  const [calibre, setCalibre] = useState(product?.calibre ?? "");
  const [unit, setUnit] = useState(product?.unit ?? UNITS[0].value);
  const [minStock, setMinStock] = useState(product?.minStock != null ? String(product.minStock) : "0");
  const [unitPrice, setUnitPrice] = useState(product?.unitPrice != null ? String(product.unitPrice) : "0");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        category,
        measure: measure.trim() || undefined,
        measureUnit: measureUnit || undefined,
        talla: talla.trim() || undefined,
        color: color || undefined,
        densidad: densidad || undefined,
        medidaRef: medidaRef.trim() || undefined,
        calibre: calibre.trim() || undefined,
        unit,
        minStock: Number(minStock),
        unitPrice: Number(unitPrice),
      };

      const saved = isEdit ? await api.updateProduct(product.id, payload) : await api.createProduct(payload);
      onSaved(saved);
    } catch {
      setError("No se pudo guardar el producto. Revisá los datos e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full border border-slate-300 dark:border-slate-600 rounded px-3 py-2 text-sm dark:bg-slate-800 dark:text-slate-100";
  const labelClass = "block text-xs text-slate-500 dark:text-slate-400 mb-1";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      {isEdit && (
        <div>
          <label className={labelClass}>Código (SKU)</label>
          <p className="text-sm text-slate-500 dark:text-slate-400">{product.sku} — se generó solo, no se puede editar</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Nombre</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del producto" />
        </div>
        <div>
          <label className={labelClass}>Categoría</label>
          <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Talla</label>
          <input className={inputClass} value={talla} onChange={(e) => setTalla(e.target.value)} placeholder="Ej. M, L, XL" />
        </div>
        <div>
          <label className={labelClass}>Color</label>
          <select className={inputClass} value={color} onChange={(e) => setColor(e.target.value)}>
            <option value="">—</option>
            {COLORES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Densidad</label>
          <select className={inputClass} value={densidad} onChange={(e) => setDensidad(e.target.value)}>
            <option value="">—</option>
            {DENSIDADES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Calibre</label>
          <input className={inputClass} value={calibre} onChange={(e) => setCalibre(e.target.value)} placeholder="Ej. 0.45" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={labelClass}>Medida</label>
          <input className={inputClass} value={measure} onChange={(e) => setMeasure(e.target.value)} placeholder="Ej. 20x30" />
        </div>
        <div>
          <label className={labelClass}>Unidad de medida</label>
          <select className={inputClass} value={measureUnit} onChange={(e) => setMeasureUnit(e.target.value)}>
            <option value="">—</option>
            {MEDIDA_UNIDADES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Medida de referencia</label>
          <input className={inputClass} value={medidaRef} onChange={(e) => setMedidaRef(e.target.value)} placeholder="Ej. Ref-14" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Unidad de stock</label>
          <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Stock mínimo</label>
          <input className={inputClass} type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Precio unitario (COP)</label>
        <input className={inputClass} type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          type="submit"
          disabled={saving}
        >
          {saving ? "Guardando..." : isEdit ? "Guardar cambios" : "Crear producto"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="text-sm px-4 py-2 rounded border">
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
