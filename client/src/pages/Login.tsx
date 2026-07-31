import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export default function Login() {
  const [email, setEmail] = useState("despacho@empresa.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { token, user } = await api.login(email, password);
      login(token, user);
      navigate("/");
    } catch {
      setError("Credenciales inválidas");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-slate-800">Inventario y Despachos</h1>
        <div>
          <label className="block text-sm text-slate-600 mb-1">Email</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-600 mb-1">Contraseña</label>
          <input
            className="w-full border rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button className="w-full bg-slate-800 text-white rounded py-2 hover:bg-slate-700" type="submit">
          Ingresar
        </button>
      </form>
    </div>
  );
}
