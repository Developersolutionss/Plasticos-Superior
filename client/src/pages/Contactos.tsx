import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, LayoutGrid, List, MoreVertical, Search } from "lucide-react";
import { api } from "../api/client";
import ClienteAvatar from "../components/ClienteAvatar";
import Modal from "../components/Modal";
import { byFrequency, nextInteraction } from "../lib/frequency";

type Filter = "abc" | "antiguedad" | "frecuentes";
type View = "list" | "cajas";

const FILTERS: { key: Filter; label: string; title: string }[] = [
  { key: "abc", label: "ABC", title: "Orden alfabético" },
  { key: "antiguedad", label: "Antigüedad", title: "Más antiguos primero" },
  { key: "frecuentes", label: "Frecuentes", title: "De los contactos más visitados" },
];

/** Pantalla global de contactos: búsqueda + filtros + vista lista/cajas.
 *
 * La frecuencia es PROPIA del contacto (independent del cliente): abrir la
 * ficha del contacto registra una visita que alimenta el ranking "Frecuentes"
 * (mismo motor que clientes). El clic abre un modal con los datos, y cada
 * contacto tiene un menú ⋮ con "Abrir empresa" y "Eliminar". */
export default function Contactos() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("frecuentes");
  const [view, setView] = useState<View>("list");
  const [companyId, setCompanyId] = useState("");
  const [selectedContact, setSelectedContact] = useState<any | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: contacts, isLoading } = useQuery({ queryKey: ["allContacts"], queryFn: api.getAllContacts });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });

  // "Esc" cierra el modal de contacto y el menú ⋮.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedContact(null);
        setOpenMenuId(null);
        setConfirmDeleteId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (contacts ?? []).filter((c: any) => {
      if (companyId && c.clientId !== Number(companyId)) return false;
      if (!q) return true;
      const companyName = c.client?.name?.toLowerCase() ?? "";
      return c.name.toLowerCase().includes(q) || companyName.includes(q);
    });
    const sorters: Record<Filter, (a: any, b: any) => number> = {
      abc: (a, b) => a.name.localeCompare(b.name),
      antiguedad: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      frecuentes: byFrequency((c) => c.viewCount, (c) => c.lastViewedAt),
    };
    return [...list].sort(sorters[filter]);
  }, [contacts, query, filter, companyId]);

  function closeMenu() {
    setOpenMenuId(null);
    setConfirmDeleteId(null);
  }

  /** Abre la ficha del contacto y registra su visita (frecuencia propia),
   * replicando el boost en vivo del servidor de forma optimista. */
  function openContact(c: any) {
    closeMenu();
    setSelectedContact(c);
    const list = contacts ?? [];
    const maxScore = Math.max(...list.map((x: any) => x.viewCount ?? 0), 0);
    queryClient.setQueryData(["allContacts"], (old: any[]) =>
      old?.map((x: any) =>
        x.id === c.id
          ? {
              ...x,
              ...nextInteraction({ viewCount: x.viewCount, cycleInteractions: x.cycleInteractions }, maxScore),
              lastViewedAt: new Date().toISOString(),
            }
          : x
      )
    );
    api.recordContactVisit(c.id).catch(() => {});
  }

  function openCompany(c: any) {
    closeMenu();
    navigate("/clientes", { state: { selectedClientId: c.clientId } });
  }

  async function handleDelete(c: any) {
    if (confirmDeleteId !== c.id) {
      setConfirmDeleteId(c.id);
      return;
    }
    try {
      await api.deleteClientContact(c.clientId, c.id);
      if (selectedContact?.id === c.id) setSelectedContact(null);
      setOpenMenuId(null);
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["allContacts"] });
    } catch {
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-800">Contactos</h1>

      {/* Búsqueda + filtros + vista */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            className="w-full border rounded pl-9 pr-3 py-2 text-sm"
            placeholder="Buscar por contacto o empresa..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <select
          className="border rounded px-3 py-2 text-sm bg-white"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          title="Filtrar por empresa"
        >
          <option value="">Todas las empresas</option>
          {clients?.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

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

      {isLoading && <p className="text-slate-500 text-sm">Cargando contactos...</p>}

      {view === "list" && !isLoading && (
        <div className="bg-white rounded-lg shadow divide-y">
          {visibleContacts.map((c: any) => (
            <div key={c.id} className="px-4 py-3 flex items-center gap-3 text-sm group">
              <div className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer" onClick={() => openContact(c)}>
                <ClienteAvatar name={c.client?.name ?? "?"} avatarUrl={c.client?.avatarUrl} size={36} />
                <span className="min-w-0">
                  <span className="block font-medium truncate">
                    {c.name}
                    {c.isPrimary && (
                      <span className="ml-2 inline-block text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full align-middle">
                        Principal
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-slate-500 truncate">
                    {c.client?.name}
                    {c.position ? ` · ${c.position}` : ""}
                  </span>
                </span>
              </div>
              <div className="relative shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === c.id ? null : c.id);
                    setConfirmDeleteId(null);
                  }}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-400"
                  title="Más opciones"
                  aria-label={`Opciones de ${c.name}`}
                >
                  <MoreVertical size={16} strokeWidth={2} aria-hidden="true" />
                </button>
                {openMenuId === c.id && <ContactMenu c={c} onCompany={() => openCompany(c)} onDelete={() => handleDelete(c)} confirming={confirmDeleteId === c.id} />}
              </div>
            </div>
          ))}
          {visibleContacts.length === 0 && <p className="p-4 text-slate-500 text-sm">No se encontraron contactos.</p>}
        </div>
      )}

      {view === "cajas" && !isLoading && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {visibleContacts.map((c: any) => (
            <div key={c.id} className="bg-white rounded-lg shadow p-4 flex flex-col items-center gap-2 relative">
              <div className="absolute top-2 right-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === c.id ? null : c.id);
                    setConfirmDeleteId(null);
                  }}
                  className="p-1.5 rounded hover:bg-slate-100 text-slate-400"
                  aria-label="Más opciones"
                >
                  <MoreVertical size={16} strokeWidth={2} aria-hidden="true" />
                </button>
                {openMenuId === c.id && <ContactMenu c={c} onCompany={() => openCompany(c)} onDelete={() => handleDelete(c)} confirming={confirmDeleteId === c.id} />}
              </div>
              <button onClick={() => openContact(c)} className="flex flex-col items-center gap-2" title="Ver información">
                <ClienteAvatar name={c.client?.name ?? "?"} avatarUrl={c.client?.avatarUrl} size={48} />
                <span className="text-sm font-medium text-center leading-tight">
                  {c.name}
                  {c.isPrimary && <span className="ml-1 text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full align-middle">P</span>}
                </span>
                {c.position && <span className="text-xs text-slate-400">{c.position}</span>}
                <span className="text-xs text-slate-500 truncate w-full text-center">{c.client?.name}</span>
              </button>
            </div>
          ))}
          {visibleContacts.length === 0 && <p className="col-span-full text-slate-500 text-sm p-2">No se encontraron contactos.</p>}
        </div>
      )}

      {/* Capa que cierra el menú ⋮ al hacer clic afuera */}
      {openMenuId != null && <div className="fixed inset-0 z-20" onClick={closeMenu} />}

      {/* Modal de detalle del contacto */}
      {selectedContact && (
        <Modal title={selectedContact.name} onClose={() => setSelectedContact(null)}>
          <div className="space-y-3 text-sm">
            {selectedContact.isPrimary && (
              <span className="inline-block text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">Contacto principal</span>
            )}
            <div className="flex items-center gap-2">
              <ClienteAvatar name={selectedContact.client?.name ?? "?"} avatarUrl={selectedContact.client?.avatarUrl} size={32} />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-slate-400">Cliente</p>
                <p className="text-slate-800 font-medium truncate">{selectedContact.client?.name ?? "-"}</p>
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Cargo</p>
              <p className="text-slate-700">{selectedContact.position ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Teléfono</p>
              {selectedContact.phone ? (
                <a href={`tel:${selectedContact.phone}`} className="text-slate-700 hover:text-sky-600">
                  {selectedContact.phone}
                </a>
              ) : (
                <p className="text-slate-700">-</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Email</p>
              {selectedContact.email ? (
                <a href={`mailto:${selectedContact.email}`} className="text-slate-700 hover:text-sky-600">
                  {selectedContact.email}
                </a>
              ) : (
                <p className="text-slate-700">-</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-400">Agregado el</p>
              <p className="text-slate-700">{new Date(selectedContact.createdAt).toLocaleString()}</p>
            </div>
            <div className="border-t pt-3 flex justify-end">
              <button
                onClick={() => openCompany(selectedContact)}
                className="flex items-center gap-1.5 text-sky-600 text-xs hover:underline"
              >
                <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
                Ver empresa
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Menú desplegable ⋮ de un contacto. Requiere un contenedor position:relative. */
function ContactMenu({ c, onCompany, onDelete, confirming }: { c: any; onCompany: () => void; onDelete: () => void; confirming: boolean }) {
  return (
    <div className="absolute right-0 top-8 z-30 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1">
      <button onClick={onCompany} className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 text-sm">
        Abrir empresa
      </button>
      <button
        onClick={onDelete}
        className={`w-full text-left px-3 py-2 text-sm ${confirming ? "text-red-700 bg-red-50 font-medium" : "text-red-600 hover:bg-red-50"}`}
      >
        {confirming ? "¿Confirmar eliminación?" : "Eliminar"}
      </button>
    </div>
  );
}