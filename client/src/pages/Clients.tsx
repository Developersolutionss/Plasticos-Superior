import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api/client";

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
  const [newClientName, setNewClientName] = useState("");
  const [contactForm, setContactForm] = useState({ name: "", position: "", phone: "", email: "", isPrimary: false });
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const newClientInputRef = useRef<HTMLInputElement>(null);
  const contactsPanelRef = useRef<HTMLDivElement>(null);

  const { data: clients, isLoading } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });
  const { data: contacts } = useQuery({
    queryKey: ["clientContacts", selectedClientId],
    queryFn: () => api.getClientContacts(selectedClientId!),
    enabled: selectedClientId != null,
  });

  const selectedClient = clients?.find((c: any) => c.id === selectedClientId);

  useEffect(() => {
    if (mode === "nuevo") {
      newClientInputRef.current?.focus();
    } else if (mode === "contactos") {
      contactsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [mode]);

  async function handleCreateClient(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!newClientName.trim()) return;
    try {
      const client = await api.createClient(newClientName.trim());
      setNewClientName("");
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setSelectedClientId(client.id);
    } catch (err: any) {
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
    } catch (err: any) {
      setError("No se pudo crear el contacto (revisá que el email sea válido)");
    }
  }

  async function handleDeleteContact(contactId: number) {
    if (!selectedClientId) return;
    await api.deleteClientContact(selectedClientId, contactId);
    queryClient.invalidateQueries({ queryKey: ["clientContacts", selectedClientId] });
  }

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

      {/* Contactos del cliente seleccionado */}
      <div ref={contactsPanelRef} className="bg-white rounded-lg shadow p-4">
        {!selectedClient && mode === "contactos" && (
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-sm">
            Elegí un cliente de la lista de la izquierda para ver y administrar sus contactos.
          </p>
        )}
        {!selectedClient && mode !== "contactos" && <p className="text-slate-500">Seleccioná un cliente para ver sus contactos.</p>}

        {selectedClient && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{selectedClient.name}</h2>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <ul className="divide-y">
              {contacts?.map((contact: any) => (
                <li key={contact.id} className="py-3 flex items-start justify-between text-sm">
                  <div>
                    <p className="font-medium">
                      {contact.name}
                      {contact.isPrimary && (
                        <span className="ml-2 text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">Principal</span>
                      )}
                    </p>
                    <p className="text-slate-500">{contact.position ?? "-"}</p>
                    <p className="text-slate-500">
                      {contact.phone ?? "-"} {contact.email ? `· ${contact.email}` : ""}
                    </p>
                  </div>
                  <button onClick={() => handleDeleteContact(contact.id)} className="text-red-600 text-xs hover:underline">
                    Eliminar
                  </button>
                </li>
              ))}
              {contacts?.length === 0 && <p className="text-slate-500 text-sm py-2">Sin contactos todavía.</p>}
            </ul>

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
      </div>
    </div>
  );
}
