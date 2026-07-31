const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Error ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<{
      token: string;
      user: { id: number; name: string; role: "produccion" | "despacho" | "admin"; email: string };
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  getInventory: (category?: string) => request<any[]>(`/inventory${category ? `?category=${category}` : ""}`),
  getAlerts: () => request<any[]>("/inventory/alerts"),
  getProducts: () => request<any[]>("/inventory/products"),

  getClients: () => request<any[]>("/clients"),
  createClient: (name: string) => request<any>("/clients", { method: "POST", body: JSON.stringify({ name }) }),

  createProductionEntry: (data: Record<string, unknown>) =>
    request<any>("/production/entries", { method: "POST", body: JSON.stringify(data) }),

  previewImport: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<{ filename: string; totalRows: number; validRows: number; invalidRows: number; rows: any[] }>(
      "/production/import/preview",
      { method: "POST", body: form }
    );
  },
  confirmImport: (filename: string, rows: any[]) =>
    request<{ processed: number; failed: number }>("/production/import/confirm", {
      method: "POST",
      body: JSON.stringify({ filename, rows }),
    }),

  getDispatches: (params?: { clientId?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.clientId) qs.set("clientId", String(params.clientId));
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<any[]>(`/dispatches${suffix}`);
  },
  createDispatch: (clientId: number, items: any[]) =>
    request<any>("/dispatches", { method: "POST", body: JSON.stringify({ clientId, items }) }),
  markItemDispatched: (dispatchId: number, itemId: number, quantityDispatched: number) =>
    request<any>(`/dispatches/${dispatchId}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ quantityDispatched }),
    }),
};
