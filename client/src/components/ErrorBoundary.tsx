import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

/** React todavía no tiene una forma con hooks de atrapar errores de render
 * — solo un componente de clase puede implementar
 * `getDerivedStateFromError`/`componentDidCatch`. Sin esto, un error en
 * cualquier pantalla rompe TODA la app (pantalla en blanco) en vez de
 * aislarse a la sección que falló. */
export default class ErrorBoundary extends Component<
  { children: ReactNode; message?: string; onRetry?: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error("ErrorBoundary atrapó un error de render:", error);
  }

  reset = () => {
    if (this.props.onRetry) {
      this.props.onRetry();
    } else {
      this.setState({ hasError: false });
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 text-center p-8 bg-white dark:bg-slate-900 rounded-lg shadow m-4">
          <AlertTriangle size={28} className="text-red-500" aria-hidden="true" />
          <p className="text-slate-700 dark:text-slate-200 text-sm">{this.props.message ?? "Algo falló. Por favor intentá de nuevo."}</p>
          <button
            type="button"
            onClick={this.reset}
            className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-sm px-4 py-2 rounded hover:bg-slate-700"
          >
            <RotateCcw size={14} aria-hidden="true" /> Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
