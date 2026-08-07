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
  updateCreditLimit: (clientId: number, creditLimit: number) =>
    request<any>(`/clients/${clientId}/credit-limit`, { method: "PATCH", body: JSON.stringify({ creditLimit }) }),

  getClientContacts: (clientId: number) => request<any[]>(`/clients/${clientId}/contacts`),
  createClientContact: (
    clientId: number,
    data: { name: string; position?: string; phone?: string; email?: string; isPrimary?: boolean }
  ) => request<any>(`/clients/${clientId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
  deleteClientContact: (clientId: number, contactId: number) =>
    request<{ ok: boolean }>(`/clients/${clientId}/contacts/${contactId}`, { method: "DELETE" }),

  getClientAddresses: (clientId: number) => request<any[]>(`/clients/${clientId}/addresses`),
  createClientAddress: (
    clientId: number,
    data: {
      label: string;
      addressLine: string;
      city?: string;
      region?: string;
      postalCode?: string;
      isPrimary?: boolean;
      notes?: string;
    }
  ) => request<any>(`/clients/${clientId}/addresses`, { method: "POST", body: JSON.stringify(data) }),
  deleteClientAddress: (clientId: number, addressId: number) =>
    request<{ ok: boolean }>(`/clients/${clientId}/addresses/${addressId}`, { method: "DELETE" }),

  getClientInteractions: (clientId: number) => request<any[]>(`/clients/${clientId}/interactions`),
  createClientInteraction: (
    clientId: number,
    data: { type: "llamada" | "email" | "reunion" | "nota"; description: string }
  ) => request<any>(`/clients/${clientId}/interactions`, { method: "POST", body: JSON.stringify(data) }),
  getClientCartera: (clientId: number) =>
    request<{ creditLimit: number; saldoPendiente: number; facturasPendientes: any[] }>(`/clients/${clientId}/cartera`),

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

  getProductionOrders: (status?: string) =>
    request<any[]>(`/production-orders${status ? `?status=${status}` : ""}`),
  createProductionOrder: (data: { productId: number; quantityPlanned: number; measure?: string; notes?: string }) =>
    request<any>("/production-orders", { method: "POST", body: JSON.stringify(data) }),
  updateProductionOrderStatus: (id: number, status: string) =>
    request<any>(`/production-orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  getProductionOrderStages: (id: number) => request<any[]>(`/production-orders/${id}/stages`),
  createProductionStageLog: (
    productionOrderId: number,
    data: {
      station: "extrusion" | "impresion" | "sellado" | "precorte";
      machine: string;
      operatorName: string;
      startTime: string;
      endTime?: string;
      kilosProduced: number;
      mermaKg?: number;
      downtimeMinutes?: number;
      downtimeReason?: string;
      details?: Record<string, unknown>;
      notes?: string;
    }
  ) => request<any>(`/production-orders/${productionOrderId}/stages`, { method: "POST", body: JSON.stringify(data) }),

  getCotizaciones: (clientId?: number) =>
    request<any[]>(`/cotizaciones${clientId ? `?clientId=${clientId}` : ""}`),
  createCotizacion: (data: {
    clientId: number;
    validUntil?: string;
    notes?: string;
    items: { productId: number; quantity: number; unitPrice?: number; measure?: string }[];
  }) => request<any>("/cotizaciones", { method: "POST", body: JSON.stringify(data) }),
  updateCotizacionStatus: (id: number, status: string) =>
    request<any>(`/cotizaciones/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  convertCotizacionToPedido: (id: number) =>
    request<any>(`/cotizaciones/${id}/convertir-a-pedido`, { method: "POST" }),

  getPedidos: (params?: { clientId?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.clientId) qs.set("clientId", String(params.clientId));
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<any[]>(`/pedidos${suffix}`);
  },
  createPedido: (data: {
    clientId: number;
    notes?: string;
    items: { productId: number; quantity: number; unitPrice?: number; measure?: string }[];
  }) => request<any>("/pedidos", { method: "POST", body: JSON.stringify(data) }),
  getPedidoVersions: (pedidoId: number) => request<any[]>(`/pedidos/${pedidoId}/versions`),
  updatePedido: (
    pedidoId: number,
    data: {
      status: string;
      notes?: string;
      items: { productId: number; quantity: number; unitPrice?: number; measure?: string }[];
    }
  ) => request<any>(`/pedidos/${pedidoId}`, { method: "PATCH", body: JSON.stringify(data) }),
  duplicatePedido: (pedidoId: number) => request<any>(`/pedidos/${pedidoId}/duplicar`, { method: "POST" }),
  getPedidoAttachments: (pedidoId: number) => request<any[]>(`/pedidos/${pedidoId}/attachments`),
  uploadPedidoAttachment: (pedidoId: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<any>(`/pedidos/${pedidoId}/attachments`, { method: "POST", body: form });
  },
  downloadPedidoAttachment: async (pedidoId: number, attachmentId: number, filename: string) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/pedidos/${pedidoId}/attachments/${attachmentId}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  getFacturas: (params?: { clientId?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.clientId) qs.set("clientId", String(params.clientId));
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<any[]>(`/facturas${suffix}`);
  },
  createFactura: (data: {
    clientId: number;
    notes?: string;
    items: { productId: number; quantity: number; unitPrice?: number; measure?: string }[];
  }) => request<any>("/facturas", { method: "POST", body: JSON.stringify(data) }),
  createFacturaFromPedido: (pedidoId: number) =>
    request<any>(`/facturas/desde-pedido/${pedidoId}`, { method: "POST" }),
  anularFactura: (id: number) => request<any>(`/facturas/${id}/anular`, { method: "PATCH" }),
  getFacturaPayments: (facturaId: number) => request<any[]>(`/facturas/${facturaId}/payments`),
  createPayment: (
    facturaId: number,
    data: { amount: number; method: "efectivo" | "transferencia" | "cheque" | "tarjeta" | "otro"; paidAt?: string; notes?: string }
  ) => request<any>(`/facturas/${facturaId}/payments`, { method: "POST", body: JSON.stringify(data) }),
};
