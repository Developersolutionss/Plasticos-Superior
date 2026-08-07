import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { api } from "../api/client";

export default function SecuritySettings() {
  const [setup, setSetup] = useState<{ qrCodeDataUrl: string; secret: string } | null>(null);
  const [verifyToken, setVerifyToken] = useState("");
  const [disableToken, setDisableToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.getMe });

  async function handleStartSetup() {
    setError(null);
    setMessage(null);
    try {
      const res = await api.setup2fa();
      setSetup(res);
    } catch {
      setError("No se pudo iniciar la configuración de 2FA");
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.verify2fa(verifyToken);
      setSetup(null);
      setVerifyToken("");
      setMessage("2FA activado correctamente.");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch {
      setError("Código inválido");
    }
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.disable2fa(disableToken);
      setDisableToken("");
      setMessage("2FA desactivado.");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch {
      setError("Código inválido");
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold text-slate-800">Seguridad de la cuenta</h1>

      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <p className="text-sm font-medium text-slate-700">Autenticación de dos factores (2FA)</p>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {message && <p className="text-emerald-700 text-sm">{message}</p>}

        {me?.twoFactorEnabled ? (
          <div className="space-y-2">
            <p className="text-sm text-emerald-700">✅ Tenés 2FA activado en tu cuenta.</p>
            <form onSubmit={handleDisable} className="flex gap-2">
              <input
                className="border rounded px-3 py-2 text-sm flex-1"
                placeholder="Código de 6 dígitos para desactivar"
                value={disableToken}
                onChange={(e) => setDisableToken(e.target.value)}
                maxLength={6}
              />
              <button className="bg-red-600 text-white text-sm px-4 py-2 rounded" type="submit">
                Desactivar
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              No tenés 2FA activado. Es opcional, pero recomendado para cuentas con más permisos.
            </p>
            {!setup && (
              <button onClick={handleStartSetup} className="bg-slate-800 text-white text-sm px-4 py-2 rounded">
                Activar 2FA
              </button>
            )}
            {setup && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Escaneá este código con Google Authenticator, Authy o similar, y confirmá con el código que te
                  muestre la app.
                </p>
                <img src={setup.qrCodeDataUrl} alt="Código QR para 2FA" className="border rounded w-48 h-48" />
                <p className="text-xs text-slate-400">
                  ¿No podés escanear? Ingresá este código a mano: <code className="font-mono">{setup.secret}</code>
                </p>
                <form onSubmit={handleVerify} className="flex gap-2">
                  <input
                    className="border rounded px-3 py-2 text-sm flex-1"
                    placeholder="Código de 6 dígitos"
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    maxLength={6}
                    autoFocus
                  />
                  <button className="bg-slate-800 text-white text-sm px-4 py-2 rounded" type="submit">
                    Confirmar
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
