import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.login(email, password, needs2fa ? totpToken : undefined);
      if (res.requires2fa) {
        setNeeds2fa(true);
        return;
      }
      if (res.token && res.user) {
        login(res.token, res.user as any);
        navigate("/");
      }
    } catch (err: any) {
      setError(err.message?.includes("bloqueada") ? err.message : needs2fa ? "Código inválido" : "Credenciales inválidas");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-800">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 p-8 rounded-lg shadow-md w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Plásticos Superior</h1>

        {!needs2fa && (
          <>
            <div>
              <label htmlFor="login-email" className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                Email
              </label>
              <input
                id="login-email"
                className="w-full border rounded px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm text-slate-600 dark:text-slate-300 mb-1">
                Contraseña
              </label>
              <input
                id="login-password"
                className="w-full border rounded px-3 py-2 dark:bg-slate-800 dark:text-slate-100"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
              />
            </div>
            <Link to="/forgot-password" className="text-xs text-sky-700 dark:text-sky-400 hover:underline block text-right">
              ¿Olvidaste tu contraseña?
            </Link>
          </>
        )}

        {needs2fa && (
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-300 mb-1">Código de la app autenticadora</label>
            <input
              className="w-full border rounded px-3 py-2 text-center text-lg tracking-widest dark:bg-slate-800 dark:text-slate-100"
              value={totpToken}
              onChange={(e) => setTotpToken(e.target.value)}
              maxLength={6}
              autoFocus
            />
          </div>
        )}

        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        <button className="w-full bg-slate-800 text-white rounded py-2 hover:bg-slate-700" type="submit">
          {needs2fa ? "Verificar" : "Ingresar"}
        </button>
        {needs2fa && (
          <button
            type="button"
            onClick={() => {
              setNeeds2fa(false);
              setTotpToken("");
            }}
            className="w-full text-sm text-slate-500 dark:text-slate-400 hover:underline"
          >
            Volver
          </button>
        )}
      </form>
    </div>
  );
}
