import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/** Frases que se van turnando mientras se arma la sesión (puramente
 * cosmético — no hay ninguna carga real detrás, es para que el salto del
 * login al dashboard no se sienta instantáneo/brusco). */
const WELCOME_STEPS = ["Verificando tus credenciales...", "Configurando tu experiencia personalizada...", "Ya casi..."];

function WelcomeTransition({ name }: { name?: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setStep((s) => Math.min(s + 1, WELCOME_STEPS.length - 1)), 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950 text-white px-6">
      <div className="bg-white/95 backdrop-blur rounded-2xl p-3.5 shadow-xl shadow-black/30 ring-1 ring-white/10">
        <img src="/logo-full.png" alt="Plásticos Superior San Judas S.A.S." className="h-12 w-auto" />
      </div>
      <Loader2 size={28} strokeWidth={2} className="animate-spin text-sky-400" aria-hidden="true" />
      <div className="text-center space-y-1">
        <p className="text-slate-100 font-medium">{name ? `Bienvenido, ${name}` : "Bienvenido"}</p>
        <p className="text-slate-400 text-sm">{WELCOME_STEPS[step]}</p>
      </div>
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpToken, setTotpToken] = useState("");
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [welcomeUser, setWelcomeUser] = useState<{ name?: string } | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.login(email, password, needs2fa ? totpToken : undefined);
      if (res.requires2fa) {
        setNeeds2fa(true);
        return;
      }
      if (res.token && res.user) {
        login(res.token, res.user as any);
        // La sesión ya quedó armada (login() de arriba) -- esta pantalla es
        // puramente de transición, para que pasar del form al dashboard no
        // se sienta como un salto brusco. `name` es opcional porque no
        // todos los roles lo traen en el payload del token.
        setWelcomeUser({ name: (res.user as any)?.name });
        setTimeout(() => navigate("/"), 1600);
      }
    } catch (err: any) {
      setError(err.message?.includes("bloqueada") ? err.message : needs2fa ? "Código inválido" : "Credenciales inválidas");
    } finally {
      setSubmitting(false);
    }
  }

  if (welcomeUser) {
    return <WelcomeTransition name={welcomeUser.name} />;
  }

  return (
    <div className="min-h-screen flex bg-slate-100 dark:bg-slate-950">
      {/* Panel de marca — solo en pantallas grandes, la versión angosta va
          directo al form para no desperdiciar espacio en el celular. */}
      <div className="hidden lg:flex lg:w-[46%] relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950 text-white">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle at 1.5px 1.5px, white 1.5px, transparent 0)",
            backgroundSize: "28px 28px",
          }}
          aria-hidden="true"
        />
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" aria-hidden="true" />

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div className="bg-white/95 backdrop-blur rounded-2xl p-3.5 w-fit shadow-xl shadow-black/30 ring-1 ring-white/10">
            <img src="/logo-full.png" alt="Plásticos Superior San Judas S.A.S." className="h-12 w-auto" />
          </div>

          <div className="space-y-5 max-w-md">
            <div className="inline-flex items-center gap-2 text-xs font-medium tracking-wide uppercase text-sky-300/90 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">
              <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" />
              Sistema interno
            </div>
            <h1 className="text-3xl font-semibold leading-tight text-white">
              Producción, inventario y despachos, todo en un solo lugar.
            </h1>
            <p className="text-slate-300 text-sm leading-relaxed">
              Iniciá sesión con tu cuenta de la empresa para seguir órdenes de producción, controlar existencias y
              gestionar pedidos y clientes.
            </p>
          </div>

          <p className="text-xs text-slate-400">© {new Date().getFullYear()} Plásticos Superior San Judas S.A.S.</p>
        </div>
      </div>

      {/* Panel del formulario */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* Siempre fondo claro, sin importar el tema -- el logo trae texto
              oscuro "quemado" en el PNG (no es un SVG que se adapte con
              currentColor), así que en modo oscuro con `dark:bg-slate-900`
              ese texto quedaba casi invisible contra un fondo casi del
              mismo tono. */}
          <div className="lg:hidden bg-white rounded-xl p-3 w-fit mx-auto mb-8 shadow-md ring-1 ring-black/5">
            <img src="/logo-full.png" alt="Plásticos Superior San Judas S.A.S." className="h-11 w-auto" />
          </div>

          <div className="mb-8 text-center lg:text-left">
            <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">
              {needs2fa ? "Verificación en dos pasos" : "Iniciar sesión"}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {needs2fa ? "Ingresá el código de tu app autenticadora para continuar." : "Ingresá tus credenciales para continuar."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!needs2fa && (
              <>
                <div>
                  <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Email
                  </label>
                  <div className="relative">
                    <Mail size={17} strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      id="login-email"
                      className="w-full border border-slate-300 dark:border-slate-700 rounded-lg pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-800 dark:focus:ring-sky-500 focus:border-transparent"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      type="email"
                      placeholder="tu@empresa.com"
                      autoComplete="email"
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Contraseña
                    </label>
                    <Link to="/forgot-password" className="text-xs text-sky-700 dark:text-sky-400 hover:underline">
                      ¿Olvidaste tu contraseña?
                    </Link>
                  </div>
                  <div className="relative">
                    <Lock size={17} strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      id="login-password"
                      className="w-full border border-slate-300 dark:border-slate-700 rounded-lg pl-10 pr-10 py-2.5 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-800 dark:focus:ring-sky-500 focus:border-transparent"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={17} strokeWidth={2} /> : <Eye size={17} strokeWidth={2} />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {needs2fa && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  Código de la app autenticadora
                </label>
                <div className="relative">
                  <KeyRound size={17} strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    className="w-full border border-slate-300 dark:border-slate-700 rounded-lg pl-10 pr-3 py-2.5 text-center text-lg tracking-[0.5em] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-800 dark:focus:ring-sky-500 focus:border-transparent"
                    value={totpToken}
                    onChange={(e) => setTotpToken(e.target.value)}
                    maxLength={6}
                    inputMode="numeric"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2.5">
                <TriangleAlert size={16} strokeWidth={2} className="shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button
              className="w-full bg-slate-800 hover:bg-slate-700 text-white rounded-lg py-2.5 font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              type="submit"
              disabled={submitting}
            >
              {submitting && <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden="true" />}
              {needs2fa ? "Verificar" : "Ingresar"}
            </button>

            {needs2fa && (
              <button
                type="button"
                onClick={() => {
                  setNeeds2fa(false);
                  setTotpToken("");
                  setError(null);
                }}
                className="w-full text-sm text-slate-500 dark:text-slate-400 hover:underline"
              >
                Volver
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
