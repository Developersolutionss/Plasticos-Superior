import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api } from "../api/client";

const STATUS_LABELS: Record<string, string> = {
  emitida: "Emitida",
  pagada_parcial: "Pagada parcial",
  pagada: "Pagada",
  anulada: "Anulada",
};

const STATUS_COLORS: Record<string, string> = {
  emitida: "bg-slate-100 text-slate-700",
  pagada_parcial: "bg-amber-100 text-amber-700",
  pagada: "bg-emerald-100 text-emerald-700",
  anulada: "bg-red-100 text-red-700",
};

const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  cheque: "Cheque",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

interface ItemDraft {
  productId: string;
  quantity: string;
  unitPrice: string;
}

const emptyItem: ItemDraft = { productId: "", quantity: "", unitPrice: "" };

function total(items: any[]) {
  return items.reduce((sum, it) => sum + Number(it.quantity) * Number(it.unitPrice), 0);
}
function totalPaid(payments: any[]) {
  return payments.reduce((sum, p) => sum + Number(p.amount), 0);
}

export default function Facturas() {
  const [selectedFacturaId, setSelectedFacturaId] = useState<number | null>(null);
  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([{ ...emptyItem }]);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "efectivo", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: products } = useQuery({ queryKey: ["products"], queryFn: api.getProducts });
  const { data: facturas, isLoading } = useQuery({ queryKey: ["facturas"], queryFn: () => api.getFacturas() });
  const { data: payments } = useQuery({
    queryKey: ["facturaPayments", selectedFacturaId],
    queryFn: () => api.getFacturaPayments(selectedFacturaId!),
    enabled: selectedFacturaId != null,
  });

  const selectedFactura = facturas?.find((f: any) => f.id === selectedFacturaId);

  function productPrice(productId: string) {
    return products?.find((p: any) => p.id === Number(productId))?.unitPrice ?? "";
  }

  function updateItem(i: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const validItems = items.filter((it) => it.productId && it.quantity);
    if (!clientId || validItems.length === 0) {
      setError("Elegí un cliente y al menos un ítem");
      return;
    }
    try {
      const factura = await api.createFactura({
        clientId: Number(clientId),
        notes: notes || undefined,
        items: validItems.map((it) => ({
          productId: Number(it.productId),
          quantity: Number(it.quantity),
          unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
        })),
      });
      setClientId("");
      setNotes("");
      setItems([{ ...emptyItem }]);
      queryClient.invalidateQueries({ queryKey: ["facturas"] });
      setSelectedFacturaId(factura.id);
    } catch {
      setError("No se pudo crear la factura");
    }
  }

  async function handleAddPayment(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedFacturaId || !paymentForm.amount) return;
    try {
      await api.createPayment(selectedFacturaId, {
        amount: Number(paymentForm.amount),
        method: paymentForm.method as any,
        notes: paymentForm.notes || undefined,
      });
      setPaymentForm({ amount: "", method: "efectivo", notes: "" });
      queryClient.invalidateQueries({ queryKey: ["facturaPayments", selectedFacturaId] });
      queryClient.invalidateQueries({ queryKey: ["facturas"] });
      setMessage("Pago registrado.");
    } catch {
      setError("No se pudo registrar el pago");
    }
  }

  async function handleAnular(id: number) {
    await api.anularFactura(id);
    queryClient.invalidateQueries({ queryKey: ["facturas"] });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
      <div className="space-y-4">
        <form onSubmit={handleCreate} className="bg-white rounded-lg shadow p-4 space-y-2">
          <p className="text-sm font-medium text-slate-700">Nueva factura</p>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <select className="border rounded px-3 py-2 text-sm w-full" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Cliente...</option>
            {clients?.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-2">
                <select
                  className="border rounded px-2 py-2 text-sm"
                  value={item.productId}
                  onChange={(e) => updateItem(i, { productId: e.target.value, unitPrice: String(productPrice(e.target.value)) })}
                >
                  <option value="">Producto...</option>
                  {products?.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  className="border rounded px-2 py-2 text-sm"
                  placeholder="Cant."
                  type="number"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value })}
                />
                <input
                  className="border rounded px-2 py-2 text-sm"
                  placeholder="Precio"
                  type="number"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(i, { unitPrice: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                  className="text-red-600 text-xs"
                  disabled={items.length === 1}
                >
                  Quitar
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setItems([...items, { ...emptyItem }])} className="text-sm text-sky-700 hover:underline">
              + Agregar ítem
            </button>
          </div>
          <input
            className="border rounded px-3 py-2 text-sm w-full"
            placeholder="Notas (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
            Crear factura
          </button>
        </form>

        <div className="bg-white rounded-lg shadow divide-y">
          {isLoading && <p className="p-4 text-slate-500 text-sm">Cargando...</p>}
          {facturas?.map((f: any) => {
            const t = total(f.items);
            const paid = totalPaid(f.payments);
            return (
              <button
                key={f.id}
                onClick={() => setSelectedFacturaId(f.id)}
                className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 ${
                  selectedFacturaId === f.id ? "bg-slate-100 font-medium" : ""
                }`}
              >
                <div className="flex justify-between">
                  <span>{f.invoiceNumber}</span>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${STATUS_COLORS[f.status]}`}>{STATUS_LABELS[f.status]}</span>
                </div>
                <div className="text-slate-500">{f.client.name}</div>
                <div className="text-xs text-slate-500">
                  ${t.toLocaleString("es-CO")} · saldo ${(t - paid).toLocaleString("es-CO")}
                </div>
              </button>
            );
          })}
          {facturas?.length === 0 && <p className="p-4 text-slate-500 text-sm">Todavía no hay facturas.</p>}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        {!selectedFactura && <p className="text-slate-500">Seleccioná una factura para ver el detalle.</p>}

        {selectedFactura && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {selectedFactura.invoiceNumber} — {selectedFactura.client.name}
              </h2>
              {selectedFactura.status !== "anulada" && (
                <button onClick={() => handleAnular(selectedFactura.id)} className="text-red-600 text-xs hover:underline">
                  Anular factura
                </button>
              )}
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            {message && <p className="text-emerald-700 text-sm">{message}</p>}

            <table className="hidden sm:table w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">Producto</th>
                  <th className="p-2">Cantidad</th>
                  <th className="p-2">Precio unit.</th>
                  <th className="p-2">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {selectedFactura.items.map((it: any) => (
                  <tr key={it.id} className="border-t">
                    <td className="p-2">{it.product.name}</td>
                    <td className="p-2">{it.quantity}</td>
                    <td className="p-2">${Number(it.unitPrice).toLocaleString("es-CO")}</td>
                    <td className="p-2">${(Number(it.quantity) * Number(it.unitPrice)).toLocaleString("es-CO")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sm:hidden divide-y border rounded">
              {selectedFactura.items.map((it: any) => (
                <div key={it.id} className="p-2.5 text-sm space-y-0.5">
                  <p className="font-medium">{it.product.name}</p>
                  <p className="text-slate-500">
                    {it.quantity} × ${Number(it.unitPrice).toLocaleString("es-CO")} = $
                    {(Number(it.quantity) * Number(it.unitPrice)).toLocaleString("es-CO")}
                  </p>
                </div>
              ))}
            </div>

            {(() => {
              const t = total(selectedFactura.items);
              const paid = payments ? totalPaid(payments) : totalPaid(selectedFactura.payments);
              return (
                <div className="text-right space-y-1">
                  <p>Total: ${t.toLocaleString("es-CO")}</p>
                  <p className="text-emerald-700">Pagado: ${paid.toLocaleString("es-CO")}</p>
                  <p className="font-medium">Saldo: ${(t - paid).toLocaleString("es-CO")}</p>
                </div>
              );
            })()}

            <div className="border-t pt-4 space-y-3">
              <p className="text-sm font-medium text-slate-700">Pagos registrados</p>
              <ul className="divide-y text-sm">
                {payments?.map((p: any) => (
                  <li key={p.id} className="py-2 flex justify-between">
                    <span>
                      {METHOD_LABELS[p.method]} {p.notes && `· ${p.notes}`}
                    </span>
                    <span>
                      ${Number(p.amount).toLocaleString("es-CO")} · {new Date(p.paidAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
                {payments?.length === 0 && <p className="text-slate-500 py-2">Sin pagos todavía.</p>}
              </ul>

              {selectedFactura.status !== "anulada" && selectedFactura.status !== "pagada" && (
                <form onSubmit={handleAddPayment} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                  <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Monto"
                    type="number"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  />
                  <select
                    className="border rounded px-3 py-2 text-sm"
                    value={paymentForm.method}
                    onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                  >
                    {Object.entries(METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="border rounded px-3 py-2 text-sm"
                    placeholder="Notas"
                    value={paymentForm.notes}
                    onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  />
                  <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
                    Registrar pago
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
