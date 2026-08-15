import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

export default function Notificaciones() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: notifications, isLoading } = useQuery({ queryKey: ["notifications"], queryFn: api.getNotifications });

  async function handleClick(n: any) {
    if (!n.read) {
      await api.markNotificationRead(n.id);
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unreadNotificationCount"] });
    }
    if (n.link) navigate(n.link);
  }

  async function handleMarkAllRead() {
    await api.markAllNotificationsRead();
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["unreadNotificationCount"] });
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Notificaciones</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Avisos del sistema para vos</p>
        </div>
        <button onClick={handleMarkAllRead} className="text-sm text-slate-600 dark:text-slate-300 hover:underline">
          Marcar todas como leídas
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {isLoading && <p className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Cargando...</p>}
        {!isLoading && notifications?.length === 0 && (
          <p className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">No tenés notificaciones.</p>
        )}
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {notifications?.map((n: any) => (
            <li key={n.id}>
              <button
                type="button"
                className={`w-full text-left px-5 py-3.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${n.read ? "text-slate-500 dark:text-slate-400" : "text-slate-800 dark:text-slate-100 font-medium"}`}
                onClick={() => handleClick(n)}
              >
                <div className="flex items-start justify-between gap-3">
                  <p>{n.message}</p>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-red-600 shrink-0 mt-1.5" />}
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-400 font-normal mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
