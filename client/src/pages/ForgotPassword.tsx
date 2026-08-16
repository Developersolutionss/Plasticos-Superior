import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      const res = await api.forgotPassword(email);
      setMessage(res.message);
    } catch {
      setError("No se pudo procesar la solicitud, intentá de nuevo.");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-800">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 p-8 rounded-lg shadow-md w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Recuperar contraseña</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">Ingresá tu email y te mandamos un link para elegir una contraseña nueva.</p>
        <input
          className="w-full border rounded px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
          type="email"
          placeholder="tu@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        {message && <p className="text-emerald-700 dark:text-emerald-400 text-sm">{message}</p>}
        <button className="w-full bg-slate-800 text-white rounded py-2 hover:bg-slate-700" type="submit">
          Enviar instrucciones
        </button>
        <Link to="/login" className="text-sm text-sky-700 dark:text-sky-400 hover:underline block text-center">
          Volver a iniciar sesión
        </Link>
      </form>
    </div>
  );
}
