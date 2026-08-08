import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (newPassword.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    try {
      await api.resetPassword(token, newPassword);
      setDone(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch {
      setError("El link es inválido o expiró. Pedí uno nuevo.");
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-600">
          Falta el token de recuperación.{" "}
          <Link to="/forgot-password" className="text-sky-700 hover:underline">
            Pedí un link nuevo
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-slate-800">Elegí una nueva contraseña</h1>
        {done ? (
          <p className="text-emerald-700 text-sm">Contraseña actualizada. Redirigiendo al login...</p>
        ) : (
          <>
            <input
              className="w-full border rounded px-3 py-2"
              type="password"
              placeholder="Nueva contraseña"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className="w-full border rounded px-3 py-2"
              type="password"
              placeholder="Confirmar contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button className="w-full bg-slate-800 text-white rounded py-2 hover:bg-slate-700" type="submit">
              Guardar nueva contraseña
            </button>
          </>
        )}
      </form>
    </div>
  );
}
