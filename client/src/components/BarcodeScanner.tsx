import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import Modal from "./Modal";

const SCANNER_ELEMENT_ID = "barcode-scanner-region";

interface BarcodeScannerProps {
  title?: string;
  onDetected: (text: string) => void;
  onClose: () => void;
}

/** Escáner de QR/código de barras con la cámara del celular (sin hardware).
 * Componente único reusado en Despacho, Producción y Almacén — cada pantalla
 * decide qué hacer con el texto decodificado (`onDetected`). */
export default function BarcodeScanner({ title = "Escanear código", onDetected, onClose }: BarcodeScannerProps) {
  const [error, setError] = useState<string | null>(null);
  const detectedRef = useRef(false);
  // Ref en vez de dependencia del effect: así un `onDetected` inline nuevo en
  // cada render del padre no reinicia la cámara (solo se monta una vez).
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);

    const startPromise = scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (decodedText) => {
        if (detectedRef.current) return;
        detectedRef.current = true;
        onDetectedRef.current(decodedText);
      },
      undefined
    );
    startPromise.catch(() => setError("No se pudo acceder a la cámara. Revisá los permisos del navegador."));

    return () => {
      // start() puede seguir esperando el permiso de cámara cuando el
      // componente se desmonta (ej. el usuario cierra el modal tocando
      // afuera antes de que la cámara termine de arrancar). Llamar stop()
      // ANTES de que start() resuelva no rechaza la promesa — html5-qrcode
      // tira una excepción SINCRÓNICA en ese caso, que un simple .catch()
      // nunca atrapa, y la cámara queda prendida sin que nadie la libere.
      // Por eso acá se espera a que start() termine (bien o mal) recién
      // ahí se intenta stop()/clear(), con un try/catch de más por si
      // igual llega a tirar sincrónico.
      startPromise
        .catch(() => {})
        .finally(() => {
          try {
            scanner.stop().catch(() => {}).finally(() => scanner.clear());
          } catch {
            scanner.clear();
          }
        });
    };
  }, []);

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div id={SCANNER_ELEMENT_ID} className="w-full rounded overflow-hidden bg-slate-900" />
        <p className="text-xs text-slate-500">Apuntá la cámara al código QR.</p>
      </div>
    </Modal>
  );
}
