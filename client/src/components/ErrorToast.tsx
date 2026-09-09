import { useEffect, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";

/** Antes los errores de esta pantalla se mostraban como un <p> arriba del
 * todo de la hoja — en el celular del operario, parado frente a la
 * extrusora con la tabla de rollos scrolleada varias pantallas hacia abajo,
 * ese mensaje quedaba fuera de la vista y nunca se enteraba de qué pasó.
 * Este popup queda fijo abajo de la pantalla (a mano, visible sin scrollear)
 * y se cierra solo a los 5s o al tocarlo. */
export default function ErrorToast({ message, onClose }: { message: string | null; onClose: () => void }) {
  // `onClose` llega como una closure nueva en cada render del padre (la
  // hoja de OP tiene muchos inputs controlados que re-renderizan en cada
  // tecla) — si estuviera en las dependencias de abajo, el timer se
  // reiniciaría en cada tecla y el popup nunca llegaría a cerrarse solo
  // mientras el operario sigue tipeando. El ref guarda siempre la versión
  // más nueva sin forzar que el timer dependa de su identidad.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => onCloseRef.current(), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  if (!message) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 pointer-events-none">
      <div
        role="alert"
        className="pointer-events-auto animate-toast-in flex items-start gap-2 max-w-md w-full bg-red-600 dark:bg-red-700 text-white text-sm rounded-lg shadow-lg px-4 py-3"
        onClick={onClose}
      >
        <AlertTriangle size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span className="flex-1">{message}</span>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="shrink-0 -m-1 p-1 hover:opacity-80">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
