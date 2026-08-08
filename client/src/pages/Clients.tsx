import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid, List, Pencil, Plus, Receipt, Search } from "lucide-react";
import { api } from "../api/client";
import Modal from "../components/Modal";
import ClienteAvatar from "../components/ClienteAvatar";
import ClienteForm from "../components/ClienteForm";
import ContactoForm from "../components/ContactoForm";
import { byFrequency, nextInteraction } from "../lib/frequency";

type Tab = "contactos" | "direcciones" | "historial" | "cartera" | "editar";
type Filter = "abc" | "antiguedad" | "frecuentes";
type View = "list" | "cajas";

const INTERACTION_LABELS: Record<string, string> = {
  llamada: "Llamada",
  email: "Email",
  reunion: "Reunión",
  nota: "Nota",
};

const FILTERS: { key: Filter; label: string; title: string }[] = [
  { key: "abc", label: "ABC", title: "Orden alfabético" },
  { key: "antiguedad", label: "Antigüedad", title: "Más antiguos primero" },
  { key: "frecuentes", label: "Frecuentes", title: "Los más visitados" },
];

export default function Clients() {
  const location = useLocation();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("frecuentes");
  const [view, setView] = useState<View>("list");
  const [selectedClientId, setSelectedClientId] = useState<number | null>(
    (location.state as { selectedClientId?: number })?.selectedClientId ?? null
  );
  const [activeTab, setActiveTab] = useState<Tab>("contactos");
  const [editingClient, setEditingClient] = useState<any | null>(null);

  const [contactForm, setContactForm] = useState({ name: "", position: "", phone: "", email: "", isPrimary: false });
  const [addressForm, setAddressForm] = useState({
    label: "",
    addressLine: "",
    city: "",
    region: "",
    postalCode: "",
    isPrimary: false,
  });
  const [interactionForm, setInteractionForm] = useState<{ type: "llamada" | "email" | "reunion" | "nota"; description: string }>({
    type: "nota",
    description: "",
  });
  const [creditLimitInput, setCreditLimitInput] = useState("");
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: clients, isLoading } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: contacts } = useQuery({
    queryKey: ["clientContacts", selectedClientId],
    queryFn: () => api.getClientContacts(selectedClientId!),
    enabled: selectedClientId != null,
  });
  const { data: addresses } = useQuery({
    queryKey: ["clientAddresses", selectedClientId],
    queryFn: () => api.getClientAddresses(selectedClientId!),
    enabled: selectedClientId != null,
  });
  const { data: cartera } = useQuery({
    queryKey: ["clientCartera", selectedClientId],
    queryFn: () => api.getClientCartera(selectedClientId!),
    enabled: selectedClientId != null,
  });
  const { data: interactions } = useQuery({
    queryKey: ["clientInteractions", selectedClientId],
    queryFn: () => api.getClientInteractions(selectedClientId!),
    enabled: selectedClientId != null,
  });

  const selectedClient = clients?.find((c: any) => c.id === selectedClientId);

  /** Resultados: búsqueda simple (substring) + orden por filtro. La búsqueda
   * fuzzy está pendiente (matcher liviano propio) y se agrega en otra iteración. */
  const visibleClients = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (clients ?? []).filter((c: any) => !q || c.name.toLowerCase().includes(q));
    const sorters: Record<Filter, (a: any, b: any) => number> = {
      abc: (a, b) => a.name.localeCompare(b.name),
      antiguedad: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      frecuentes: byFrequency((c) => c.viewCount, (c) => c.lastViewedAt),
    };
    return [...list].sort(sorters[filter]);
  }, [clients, query, filter]);

  function selectClient(c: any) {
    if (selectedClientId === c.id) return;
    setSelectedClientId(c.id);
    // Actualización optimista + registro en backend (alimenta "Frecuentes").
    // Replica el boost en vivo: al cruzar el umbral de interacciones el cliente
    // sube arriba del ranking al instante, sin esperar al refresh.
    queryClient.setQueryData(["clients"], (old: any[]) => {
      const maxScore = Math.max(...(old ?? []).map((x) => x.viewCount ?? 0), 0);
      return old?.map((x) =>
        x.id === c.id
          ? { ...x, ...nextInteraction(x, maxScore), lastViewedAt: new Date().toISOString() }
          : x
      );
    });
    api.recordClientVisit(c.id).catch(() => {});
  }

  useEffect(() => {
    setCreditLimitInput(selectedClient?.creditLimit != null ? String(selectedClient.creditLimit) : "");
  }, [selectedClientId, selectedClient?.creditLimit]);

  async function handleCreateContact(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedClientId || !contactForm.name.trim()) return;
    try {
      await api.createClientContact(selectedClientId, {
        name: contactForm.name.trim(),
        position: contactForm.position || undefined,
        phone: contactForm.phone || undefined,
        email: contactForm.email || undefined,
        isPrimary: contactForm.isPrimary,
      });
      setContactForm({ name: "", position: "", phone: "", email: "", isPrimary: false });
      queryClient.invalidateQueries({ queryKey: ["clientContacts", selectedClientId] });
    } catch {
      setError("No se pudo crear el contacto (revisá que el email sea válido)");
    }
  }

  async function handleDeleteContact(contactId: number) {
    if (!selectedClientId) return;
    await api.deleteClientContact(selectedClientId, contactId);
    queryClient.invalidateQueries({ queryKey: ["clientContacts", selectedClientId] });
  }

  /** Guarda los cambios del contacto y refresca ficha y listado global. */
  async function saveContactEdit(data: any) {
    if (!selectedClientId || !selectedContact) return;
    try {
      const updated = await api.updateClientContact(selectedClientId, selectedContact.id, data);
      setEditingContact(false);
      setSelectedContact((prev: any) => (prev?.id === selectedContact.id ? { ...prev, ...updated } : prev));
      queryClient.invalidateQueries({ queryKey: ["clientContacts", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["allContacts"] });
    } catch {
      // se mantiene la edición abierta para reintentar
    }
  }

  async function handleCreateAddress(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedClientId || !addressForm.label.trim() || !addressForm.addressLine.trim()) return;
    try {
      await api.createClientAddress(selectedClientId, {
        label: addressForm.label.trim(),
        addressLine: addressForm.addressLine.trim(),
        city: addressForm.city || undefined,
        region: addressForm.region || undefined,
        postalCode: addressForm.postalCode || undefined,
        isPrimary: addressForm.isPrimary,
      });
      setAddressForm({ label: "", addressLine: "", city: "", region: "", postalCode: "", isPrimary: false });
      queryClient.invalidateQueries({ queryKey: ["clientAddresses", selectedClientId] });
    } catch {
      setError("No se pudo crear la dirección");
    }
  }

  async function handleDeleteAddress(addressId: number) {
    if (!selectedClientId) return;
    await api.deleteClientAddress(selectedClientId, addressId);
    queryClient.invalidateQueries({ queryKey: ["clientAddresses", selectedClientId] });
  }

  async function handleCreateInteraction(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedClientId || !interactionForm.description.trim()) return;
    try {
      await api.createClientInteraction(selectedClientId, {
        type: interactionForm.type,
        description: interactionForm.description.trim(),
      });
      setInteractionForm({ type: "nota", description: "" });
      queryClient.invalidateQueries({ queryKey: ["clientInteractions", selectedClientId] });
    } catch {
      setError("No se pudo registrar la interacción");
    }
  }

  async function handleSaveCreditLimit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedClientId || creditLimitInput === "") return;
    try {
      await api.updateCreditLimit(selectedClientId, Number(creditLimitInput));
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["clientCartera", selectedClientId] });
    } catch {
      setError("No se pudo actualizar el límite de crédito");
    }
  }

  async function handleDeleteClient() {
    if (!selectedClientId) return;
    setError(null);
    try {
      await api.deleteClient(selectedClientId);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setSelectedClientId(null);
      setConfirmingDelete(false);
    } catch {
      setError("No se pudo eliminar el cliente");
      setConfirmingDelete(false);
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "contactos", label: "Contactos" },
    { key: "direcciones", label: "Direcciones" },
    { key: "historial", label: "Historial" },
    { key: "cartera", label: "Cartera" },
    { key: "editar", label: "Editar / Eliminar" },
  ];

  function clienteEmail(c: any) {
    return (c.contactInfo as Record<string, string> | null | undefined)?.email;
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-slate-800">Clientes</h1>
        <button
          onClick={() => navigate("/clientes/nuevo")}
          className="bg-slate-800 text-white text-sm px-4 py-2 rounded inline-flex items-center gap-1.5 hover:bg-slate-700"
        >
          <Plus size={16} strokeWidth={2} aria-hidden="true" /> Crear cliente
        </button>
      </div>

      {/* Barra de búsqueda + filtros + vista */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            className="w-full border rounded pl-9 pr-3 py-2 text-sm"
            placeholder="Buscar cliente por nombre..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex gap-1 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              title={f.title}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                filter === f.key ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1 border rounded-lg overflow-hidden bg-white">
          <button
            onClick={() => setView("list")}
            title="Vista en lista"
            className={`p-2 ${view === "list" ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}
          >
            <List size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            onClick={() => setView("cajas")}
            title="Vista en cajas"
            className={`p-2 ${view === "cajas" ? "bg-slate-100 text-slate-800" : "text-slate-500"}`}
          >
            <LayoutGrid size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* Resultados */}
        <div className="space-y-4">
          {isLoading && <p className="text-slate-500 text-sm p-2">Cargando clientes...</p>}

          {view === "list" && !isLoading && (
            <div className="bg-white rounded-lg shadow divide-y">
              {visibleClients.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c)}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-slate-50 text-sm ${
                    selectedClientId === c.id ? "bg-slate-100" : ""
                  }`}
                >
                  <ClienteAvatar name={c.name} avatarUrl={c.avatarUrl} size={36} />
                  <span className="min-w-0">
                    <span className="block font-medium truncate">{c.name}</span>
                    {clienteEmail(c) && <span className="block text-xs text-slate-500 truncate">{clienteEmail(c)}</span>}
                  </span>
                </button>
              ))}
              {visibleClients.length === 0 && <p className="p-4 text-slate-500 text-sm">No se encontraron clientes.</p>}
            </div>
          )}

          {view === "cajas" && !isLoading && (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {visibleClients.map((c: any) => (
                <button
                  key={c.id}
                  onClick={() => selectClient(c)}
                  className={`bg-white rounded-lg shadow p-4 flex flex-col items-center gap-2 hover:shadow-md transition ${
                    selectedClientId === c.id ? "ring-2 ring-sky-500" : ""
                  }`}
                >
                  <ClienteAvatar name={c.name} avatarUrl={c.avatarUrl} size={48} />
                  <span className="text-sm font-medium text-center leading-tight">{c.name}</span>
                  {clienteEmail(c) && <span className="text-xs text-slate-400 text-center truncate w-full">{clienteEmail(c)}</span>}
                </button>
              ))}
              {visibleClients.length === 0 && <p className="col-span-full text-slate-500 text-sm p-2">No se encontraron clientes.</p>}
            </div>
          )}
        </div>

        {/* Ficha del cliente seleccionado */}
        <div className="bg-white rounded-lg shadow p-4">
          {!selectedClient && (
            <p className="text-slate-500">Seleccioná un cliente de la lista para ver su ficha.</p>
          )}

          {selectedClient && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <ClienteAvatar name={selectedClient.name} avatarUrl={selectedClient.avatarUrl} size={44} />
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{selectedClient.name}</h2>
                    <button
                      onClick={() => setEditingClient(selectedClient)}
                      className="text-sky-700 text-xs hover:underline inline-flex items-center gap-1"
                    >
                      <Pencil size={12} strokeWidth={2} aria-hidden="true" /> Editar datos / foto
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => navigate("/clientes/cotizaciones", { state: { clientId: selectedClient.id } })}
                  className="bg-slate-800 text-white text-sm px-3 py-1.5 rounded inline-flex items-center gap-1.5 hover:bg-slate-700 shrink-0"
                  title={`Cotizar para ${selectedClient.name}`}
                >
                  <Receipt size={15} strokeWidth={2} aria-hidden="true" /> Cotizar
                </button>
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}

              <div className="flex gap-1 border-b">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                      activeTab === t.key ? "border-slate-800 font-medium text-slate-800" : "border-transparent text-slate-500"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {activeTab === "contactos" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {contacts?.map((contact: any) => (
                      <button
                        key={contact.id}
                        onClick={() => setSelectedContact(contact)}
                        className="text-left border rounded-lg p-4 hover:border-slate-400 hover:shadow-sm transition"
                      >
                        <p className="font-medium flex items-center gap-2">
                          {contact.name}
                          {contact.isPrimary && (
                            <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">Principal</span>
                          )}
                        </p>
                        <p className="text-slate-500 text-sm mt-1">{contact.position ?? "Sin cargo"}</p>
                        <p className="text-slate-400 text-xs mt-2">Ver detalle →</p>
                      </button>
                    ))}
                    {contacts?.length === 0 && (
                      <p className="text-slate-500 text-sm py-2 col-span-full">Sin contactos todavía.</p>
                    )}
                  </div>

                  <form onSubmit={handleCreateContact} className="border-t pt-4 space-y-2">
                    <p className="text-sm font-medium text-slate-700">Agregar contacto</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Nombre"
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      />
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Cargo"
                        value={contactForm.position}
                        onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })}
                      />
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Teléfono"
                        value={contactForm.phone}
                        onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                      />
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Email"
                        type="email"
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={contactForm.isPrimary}
                        onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })}
                      />
                      Marcar como contacto principal
                    </label>
                    <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
                      Agregar contacto
                    </button>
                  </form>
                </div>
              )}

              {activeTab === "direcciones" && (
                <div className="space-y-4">
                  <ul className="divide-y">
                    {addresses?.map((addr: any) => (
                      <li key={addr.id} className="py-3 flex items-start justify-between text-sm">
                        <div>
                          <p className="font-medium">
                            {addr.label}
                            {addr.isPrimary && (
                              <span className="ml-2 text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">Principal</span>
                            )}
                          </p>
                          <p className="text-slate-500">{addr.addressLine}</p>
                          <p className="text-slate-500">
                            {[addr.city, addr.region, addr.postalCode].filter(Boolean).join(", ") || "-"}
                          </p>
                        </div>
                        <button onClick={() => handleDeleteAddress(addr.id)} className="text-red-600 text-xs hover:underline">
                          Eliminar
                        </button>
                      </li>
                    ))}
                    {addresses?.length === 0 && <p className="text-slate-500 text-sm py-2">Sin direcciones todavía.</p>}
                  </ul>

                  <form onSubmit={handleCreateAddress} className="border-t pt-4 space-y-2">
                    <p className="text-sm font-medium text-slate-700">Agregar dirección</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Etiqueta (ej. Bodega Principal)"
                        value={addressForm.label}
                        onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })}
                      />
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Dirección"
                        value={addressForm.addressLine}
                        onChange={(e) => setAddressForm({ ...addressForm, addressLine: e.target.value })}
                      />
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Ciudad"
                        value={addressForm.city}
                        onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                      />
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Región / Depto"
                        value={addressForm.region}
                        onChange={(e) => setAddressForm({ ...addressForm, region: e.target.value })}
                      />
                      <input
                        className="border rounded px-3 py-2 text-sm"
                        placeholder="Código postal"
                        value={addressForm.postalCode}
                        onChange={(e) => setAddressForm({ ...addressForm, postalCode: e.target.value })}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={addressForm.isPrimary}
                        onChange={(e) => setAddressForm({ ...addressForm, isPrimary: e.target.checked })}
                      />
                      Marcar como dirección principal
                    </label>
                    <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
                      Agregar dirección
                    </button>
                  </form>
                </div>
              )}

              {activeTab === "historial" && (
                <div className="space-y-4">
                  <ul className="divide-y">
                    {interactions?.map((it: any) => (
                      <li key={it.id} className="py-3 text-sm">
                        <p>
                          <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full mr-2">
                            {INTERACTION_LABELS[it.type]}
                          </span>
                          {new Date(it.createdAt).toLocaleString()}
                        </p>
                        <p className="text-slate-700 mt-1">{it.description}</p>
                      </li>
                    ))}
                    {interactions?.length === 0 && <p className="text-slate-500 text-sm py-2">Sin interacciones todavía.</p>}
                  </ul>

                  <form onSubmit={handleCreateInteraction} className="border-t pt-4 space-y-2">
                    <p className="text-sm font-medium text-slate-700">Registrar interacción</p>
                    <select
                      className="border rounded px-3 py-2 text-sm w-full"
                      value={interactionForm.type}
                      onChange={(e) => setInteractionForm({ ...interactionForm, type: e.target.value as any })}
                    >
                      <option value="llamada">Llamada</option>
                      <option value="email">Email</option>
                      <option value="reunion">Reunión</option>
                      <option value="nota">Nota</option>
                    </select>
                    <textarea
                      className="border rounded px-3 py-2 text-sm w-full"
                      placeholder="Descripción"
                      rows={2}
                      value={interactionForm.description}
                      onChange={(e) => setInteractionForm({ ...interactionForm, description: e.target.value })}
                    />
                    <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
                      Registrar
                    </button>
                  </form>
                </div>
              )}

              {activeTab === "cartera" && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4 max-w-md">
                    <div className="border rounded-lg p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Límite de crédito</p>
                      <p className="text-lg font-semibold">${Number(cartera?.creditLimit ?? 0).toLocaleString("es-CO")}</p>
                    </div>
                    <div className="border rounded-lg p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-400">Saldo pendiente</p>
                      <p className={`text-lg font-semibold ${Number(cartera?.saldoPendiente) > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                        ${Number(cartera?.saldoPendiente ?? 0).toLocaleString("es-CO")}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    El saldo pendiente se calcula solo, sumando las facturas no anuladas de este cliente menos los pagos
                    recibidos (módulo Facturas).
                  </p>

                  {cartera && cartera.facturasPendientes.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-slate-700 mb-2">Facturas con saldo pendiente</p>
                      <ul className="divide-y text-sm">
                        {cartera.facturasPendientes.map((f: any) => (
                          <li key={f.id} className="py-2 flex justify-between">
                            <span>{f.invoiceNumber}</span>
                            <span>
                              ${f.saldo.toLocaleString("es-CO")} de ${f.total.toLocaleString("es-CO")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <form onSubmit={handleSaveCreditLimit} className="space-y-2 max-w-xs border-t pt-4">
                    <label className="block text-sm font-medium text-slate-700">Editar límite de crédito (COP)</label>
                    <input
                      className="border rounded px-3 py-2 text-sm w-full"
                      type="number"
                      min={0}
                      value={creditLimitInput}
                      onChange={(e) => setCreditLimitInput(e.target.value)}
                    />
                    <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
                      Guardar
                    </button>
                  </form>
                </div>
              )}

              {activeTab === "editar" && (
                <div className="space-y-6">
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-2">Editar datos</p>
                    <button
                      onClick={() => setEditingClient(selectedClient)}
                      className="border border-slate-300 rounded px-4 py-2 text-sm inline-flex items-center gap-1.5 hover:bg-slate-50"
                    >
                      <Pencil size={14} strokeWidth={2} aria-hidden="true" /> Editar datos
                    </button>
                  </div>

                  <div className="border-t pt-4">
                    <p className="text-sm font-medium text-slate-700 mb-1">Zona de peligro</p>
                    <p className="text-xs text-slate-500 mb-3">
                      Al eliminar, el cliente se desactiva y deja de aparecer en las listas. Sus facturas, cotizaciones y
                      pedidos se conservan.
                    </p>
                    {confirmingDelete ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleDeleteClient}
                          className="bg-red-600 text-white text-sm px-4 py-2 rounded hover:bg-red-700"
                        >
                          Confirmar eliminación
                        </button>
                        <button
                          onClick={() => setConfirmingDelete(false)}
                          className="border border-slate-300 text-slate-700 text-sm px-4 py-2 rounded hover:bg-slate-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingDelete(true)}
                        className="text-red-600 text-sm hover:underline inline-flex items-center gap-1.5"
                      >
                        Eliminar cliente
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal: editar cliente (reutiliza ClienteForm) */}
      {editingClient && (
        <Modal title={`Editar: ${editingClient.name}`} onClose={() => setEditingClient(null)}>
          <ClienteForm
            client={editingClient}
            onSaved={(client) => {
              queryClient.invalidateQueries({ queryKey: ["clients"] });
              setSelectedClientId(client.id);
              setEditingClient(null);
            }}
            onCancel={() => setEditingClient(null)}
          />
        </Modal>
      )}

      {/* Modal de detalle de contacto */}
      {selectedContact && (
        <Modal
          title={selectedContact.name}
          onClose={() => {
            setSelectedContact(null);
            setEditingContact(false);
          }}
        >
          {editingContact ? (
            <ContactoForm
              initial={selectedContact}
              submitLabel="Guardar cambios"
              onCancel={() => setEditingContact(false)}
              onSubmit={saveContactEdit}
            />
          ) : (
            <div className="space-y-3 text-sm">
              {selectedContact.isPrimary && (
                <span className="inline-block text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">
                  Contacto principal
                </span>
              )}
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Cargo</p>
                <p className="text-slate-700">{selectedContact.position ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Teléfono</p>
                <p className="text-slate-700">{selectedContact.phone ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Email</p>
                <p className="text-slate-700">{selectedContact.email ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Agregado el</p>
                <p className="text-slate-700">{new Date(selectedContact.createdAt).toLocaleString()}</p>
              </div>
              <div className="border-t pt-3 flex items-center justify-between">
                <button
                  onClick={() => setEditingContact(true)}
                  className="flex items-center gap-1.5 text-slate-600 text-xs hover:underline"
                >
                  <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                  Editar
                </button>
                <button
                  onClick={() => {
                    handleDeleteContact(selectedContact.id);
                    setSelectedContact(null);
                    setEditingContact(false);
                  }}
                  className="text-red-600 text-xs hover:underline"
                >
                  Eliminar contacto
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}