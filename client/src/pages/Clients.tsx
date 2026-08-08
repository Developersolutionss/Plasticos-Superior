import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";
import Modal from "../components/Modal";

type Tab = "contactos" | "direcciones" | "historial" | "cartera";

const INTERACTION_LABELS: Record<string, string> = {
  llamada: "Llamada",
  email: "Email",
  reunion: "Reunión",
  nota: "Nota",
};

export default function Clients() {
  const location = useLocation();
  // El sidebar tiene 3 accesos distintos a esta misma pantalla:
  // /clientes (listado), /clientes/nuevo (foco en alta) y
  // /clientes/contactos (foco en el panel de contactos).
  const mode = location.pathname.endsWith("/nuevo")
    ? "nuevo"
    : location.pathname.endsWith("/contactos")
      ? "contactos"
      : "listado";

  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("contactos");
  const [newClientName, setNewClientName] = useState("");
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
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const newClientInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (mode === "nuevo") {
      newClientInputRef.current?.focus();
    } else if (mode === "contactos") {
      setActiveTab("contactos");
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [mode]);

  useEffect(() => {
    setCreditLimitInput(selectedClient?.creditLimit != null ? String(selectedClient.creditLimit) : "");
  }, [selectedClient?.id]);

  async function handleCreateClient(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newClientName.trim()) return;
    try {
      const client = await api.createClient(newClientName.trim());
      setNewClientName("");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setSelectedClientId(client.id);
    } catch {
      setError("No se pudo crear el cliente");
    }
  }

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
    } catch {
      setError("No se pudo actualizar el límite de crédito");
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "contactos", label: "Contactos" },
    { key: "direcciones", label: "Direcciones" },
    { key: "historial", label: "Historial" },
    { key: "cartera", label: "Cartera" },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      {/* Listado + alta de clientes */}
      <div className="space-y-4">
        <form onSubmit={handleCreateClient} className="bg-white rounded-lg shadow p-4 space-y-2">
          <label className="block text-sm font-medium text-slate-700">Nuevo cliente</label>
          <div className="flex gap-2">
            <input
              ref={newClientInputRef}
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder="Nombre del cliente"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
            />
            <button className="bg-slate-800 text-white text-sm px-3 py-2 rounded" type="submit">
              Crear
            </button>
          </div>
        </form>

        <div className="bg-white rounded-lg shadow divide-y">
          {isLoading && <p className="p-4 text-slate-500 text-sm">Cargando...</p>}
          {clients?.map((c: any) => (
            <button
              key={c.id}
              onClick={() => setSelectedClientId(c.id)}
              className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 ${
                selectedClientId === c.id ? "bg-slate-100 font-medium" : ""
              }`}
            >
              {c.name}
            </button>
          ))}
          {clients?.length === 0 && <p className="p-4 text-slate-500 text-sm">Todavía no hay clientes.</p>}
        </div>
      </div>

      {/* Detalle del cliente seleccionado */}
      <div ref={panelRef} className="bg-white rounded-lg shadow p-4">
        {!selectedClient && mode === "contactos" && (
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm">
            Elegí un cliente de la lista de la izquierda para ver y administrar sus contactos.
          </p>
        )}
        {!selectedClient && mode !== "contactos" && <p className="text-slate-500">Seleccioná un cliente para ver su ficha.</p>}

        {selectedClient && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{selectedClient.name}</h2>
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
                    <p className="text-lg font-semibold">
                      ${Number(cartera?.creditLimit ?? 0).toLocaleString("es-CO")}
                    </p>
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
          </div>
        )}
      </div>

      {selectedContact && (
        <Modal title={selectedContact.name} onClose={() => setSelectedContact(null)}>
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
            <div className="border-t pt-3 flex justify-end">
              <button
                onClick={() => {
                  handleDeleteContact(selectedContact.id);
                  setSelectedContact(null);
                }}
                className="text-red-600 text-xs hover:underline"
              >
                Eliminar contacto
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
