import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "../api/client";

const TABLES = ["Client", "Dispatch", "ProductionEntry", "InventoryMovement"];

const TABLE_LABELS: Record<string, string> = {
  Client: "Clientes",
  Dispatch: "Despachos",
  ProductionEntry: "Entradas de producción",
  InventoryMovement: "Movimientos de inventario",
};

const ACTION_LABELS: Record<string, string> = {
  create: "Creación",
  update: "Edición",
  delete: "Eliminación",
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400",
  update: "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-400",
  delete: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400",
};

const PAGE_SIZE = 50;

function DiffDetail({ log }: { log: any }) {
  return (
    <div className="p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Antes</p>
          <pre className="bg-white dark:bg-slate-900 border rounded p-2 text-xs overflow-x-auto max-h-64">
            {log.before ? JSON.stringify(log.before, null, 2) : "—"}
          </pre>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Después</p>
          <pre className="bg-white dark:bg-slate-900 border rounded p-2 text-xs overflow-x-auto max-h-64">
            {log.after ? JSON.stringify(log.after, null, 2) : "—"}
          </pre>
        </div>
      </div>
      {log.userAgent && <p className="text-xs text-slate-400 dark:text-slate-400 mt-2 break-all">{log.userAgent}</p>}
    </div>
  );
}

export default function Auditoria() {
  const [tableName, setTableName] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["auditLog", tableName, page],
    queryFn: () => api.getAuditLog({ tableName: tableName || undefined, page, pageSize: PAGE_SIZE }),
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Auditoría</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Bitácora de cambios en tablas críticas: quién, qué, cuándo y desde dónde</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
        <select
          className="border rounded px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          value={tableName}
          onChange={(e) => {
            setTableName(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Todas las tablas</option>
          {TABLES.map((t) => (
            <option key={t} value={t}>
              {TABLE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</div>}
      {!isLoading && data?.items.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-4 text-center text-slate-500 dark:text-slate-400 text-sm">
          Sin registros de auditoría todavía.
        </div>
      )}

      {!isLoading && data && data.items.length > 0 && (
        <>
          <div className="hidden md:block bg-white dark:bg-slate-900 rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800 text-left">
                <tr>
                  <th className="p-3 w-8"></th>
                  <th className="p-3">Tabla</th>
                  <th className="p-3">Registro</th>
                  <th className="p-3">Acción</th>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">IP</th>
                  <th className="p-3">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((log: any) => (
                  <Fragment key={log.id}>
                    <tr
                      className="border-t cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <td className="p-3 text-slate-400 dark:text-slate-400">
                        {expandedId === log.id ? (
                          <ChevronDown size={14} strokeWidth={2} />
                        ) : (
                          <ChevronRight size={14} strokeWidth={2} />
                        )}
                      </td>
                      <td className="p-3">{TABLE_LABELS[log.tableName] ?? log.tableName}</td>
                      <td className="p-3">#{log.recordId ?? "—"}</td>
                      <td className="p-3">
                        <span className={`text-xs rounded-full px-2 py-1 ${ACTION_COLORS[log.action]}`}>
                          {ACTION_LABELS[log.action] ?? log.action}
                        </span>
                      </td>
                      <td className="p-3">{log.user?.name ?? "—"}</td>
                      <td className="p-3 text-slate-500 dark:text-slate-400">{log.ipAddress ?? "—"}</td>
                      <td className="p-3 text-slate-500 dark:text-slate-400">{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                    {expandedId === log.id && (
                      <tr className="border-t bg-slate-50 dark:bg-slate-800">
                        <td></td>
                        <td colSpan={6}>
                          <DiffDetail log={log} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden bg-white dark:bg-slate-900 rounded-lg shadow divide-y divide-slate-100 dark:divide-slate-700">
            {data.items.map((log: any) => (
              <div key={log.id}>
                <button
                  type="button"
                  className="w-full text-left p-4 space-y-1.5"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-slate-800 dark:text-slate-100">
                      {TABLE_LABELS[log.tableName] ?? log.tableName} #{log.recordId ?? "—"}
                    </p>
                    <span className={`text-xs rounded-full px-2 py-1 ${ACTION_COLORS[log.action]}`}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {log.user?.name ?? "—"} · {log.ipAddress ?? "—"}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-400">{new Date(log.createdAt).toLocaleString()}</p>
                </button>
                {expandedId === log.id && (
                  <div className="bg-slate-50 dark:bg-slate-800">
                    <DiffDetail log={log} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {data && data.total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <button
            className="px-3 py-1.5 border rounded disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="text-slate-500 dark:text-slate-400">
            Página {page} de {totalPages}
          </span>
          <button
            className="px-3 py-1.5 border rounded disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
