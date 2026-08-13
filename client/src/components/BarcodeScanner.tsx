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

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 250 },
        (decodedText) => {
          if (detectedRef.current) return;
          detectedRef.current = true;
          onDetectedRef.current(decodedText);
        },
        undefined
      )
      .catch(() => setError("No se pudo acceder a la cámara. Revisá los permisos del navegador."));

    return () => {
      // stop() puede rechazar si el scanner nunca llegó a arrancar (ej. permiso
      // denegado) — no importa, solo estamos liberando la cámara al cerrar.
      scanner.stop().catch(() => {}).finally(() => scanner.clear());
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
