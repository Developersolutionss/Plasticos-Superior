import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { LayoutGrid, List, Search } from "lucide-react";
import { api } from "../api/client";
import ClienteAvatar from "../components/ClienteAvatar";
import { byFrequency } from "../lib/frequency";

type Filter = "abc" | "antiguedad" | "frecuentes";
type View = "list" | "cajas";

const FILTERS: { key: Filter; label: string; title: string }[] = [
  { key: "abc", label: "ABC", title: "Orden alfabético" },
  { key: "antiguedad", label: "Antigüedad", title: "Más antiguos primero" },
  { key: "frecuentes", label: "Frecuentes", title: "De los clientes más visitados" },
];

/** Pantalla global de contactos: búsqueda + filtros + vista lista/boxes,
 * con el avatar de la empresa relacionada en las cajas. El filtro "por
 * empresa relacionada" se hace con un select de clientes. */
export default function Contactos() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("frecuentes");
  const [view, setView] = useState<View>("list");
  const [companyId, setCompanyId] = useState("");

  const { data: contacts, isLoading } = useQuery({ queryKey: ["allContacts"], queryFn: api.getAllContacts });
  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: api.getClients });

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
      frecuentes: byFrequency((c) => c.client?.viewCount, (c) => c.client?.lastViewedAt),
    };
    return [...list].sort(sorters[filter]);
  }, [contacts, query, filter, companyId]);

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
            <div key={c.id} className="px-4 py-3 flex items-center gap-3 text-sm">
              <ClienteAvatar name={c.client?.name ?? "?"} avatarUrl={c.client?.avatarUrl} size={36} />
              <span className="min-w-0">
                <span className="block font-medium truncate">{c.name}</span>
                <span className="block text-xs text-slate-500 truncate">
                  {c.client?.name}
                  {c.position ? ` · ${c.position}` : ""}
                </span>
              </span>
            </div>
          ))}
          {visibleContacts.length === 0 && <p className="p-4 text-slate-500 text-sm">No se encontraron contactos.</p>}
        </div>
      )}

      {view === "cajas" && !isLoading && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {visibleContacts.map((c: any) => (
            <div key={c.id} className="bg-white rounded-lg shadow p-4 flex flex-col items-center gap-2">
              <ClienteAvatar name={c.client?.name ?? "?"} avatarUrl={c.client?.avatarUrl} size={48} />
              <span className="text-sm font-medium text-center leading-tight">{c.name}</span>
              {c.position && <span className="text-xs text-slate-400">{c.position}</span>}
              <span className="text-xs text-slate-500 truncate w-full text-center">{c.client?.name}</span>
            </div>
          ))}
          {visibleContacts.length === 0 && <p className="col-span-full text-slate-500 text-sm p-2">No se encontraron contactos.</p>}
        </div>
      )}
    </div>
  );
}