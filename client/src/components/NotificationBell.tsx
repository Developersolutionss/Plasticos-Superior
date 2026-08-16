import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { api } from "../api/client";

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: unread } = useQuery({
    queryKey: ["unreadNotificationCount"],
    queryFn: api.getUnreadNotificationCount,
    refetchInterval: 60000,
  });

  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: api.getNotifications,
    enabled: open,
  });

  async function handleClickNotification(n: any) {
    if (!n.read) {
      await api.markNotificationRead(n.id);
      queryClient.invalidateQueries({ queryKey: ["unreadNotificationCount"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function handleMarkAllRead() {
    await api.markAllNotificationsRead();
    queryClient.invalidateQueries({ queryKey: ["unreadNotificationCount"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="relative text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
        onClick={() => setOpen((o) => !o)}
        title="Notificaciones"
      >
        <Bell size={18} strokeWidth={2} aria-hidden="true" />
        {!!unread?.count && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] leading-none rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unread.count > 9 ? "9+" : unread.count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 shadow-lg z-50 max-h-96 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Notificaciones</p>
              <button className="text-xs text-slate-500 dark:text-slate-400 hover:underline" onClick={handleMarkAllRead}>
                Marcar todas como leídas
              </button>
            </div>
            {notifications?.length === 0 && <p className="p-4 text-center text-slate-500 dark:text-slate-400 text-sm">Sin notificaciones.</p>}
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {notifications?.map((n: any) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${n.read ? "text-slate-500 dark:text-slate-400" : "text-slate-800 dark:text-slate-100 font-medium"}`}
                    onClick={() => handleClickNotification(n)}
                  >
                    <p>{n.message}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-400 font-normal mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="w-full text-center text-xs text-slate-500 dark:text-slate-400 hover:underline px-4 py-2.5 border-t border-slate-100 dark:border-slate-700"
              onClick={() => {
                setOpen(false);
                navigate("/notificaciones");
              }}
            >
              Ver todas
            </button>
          </div>
        </>
      )}
    </div>
  );
}
