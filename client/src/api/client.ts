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
  login: (email: string, password: string, totpToken?: string) =>
    request<{
      token?: string;
      requires2fa?: boolean;
      user?: { id: number; name: string; role: string; email: string; twoFactorEnabled: boolean };
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, totpToken }),
    }),
  getMe: () => request<{ id: number; name: string; email: string; role: string; twoFactorEnabled: boolean }>("/auth/me"),

  forgotPassword: (email: string) =>
    request<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ message: string }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),

  setup2fa: () => request<{ qrCodeDataUrl: string; secret: string }>("/auth/2fa/setup", { method: "POST" }),
  verify2fa: (token: string) => request<{ ok: boolean }>("/auth/2fa/verify", { method: "POST", body: JSON.stringify({ token }) }),
  disable2fa: (token: string) => request<{ ok: boolean }>("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ token }) }),

  getInventory: (category?: string) => request<any[]>(`/inventory${category ? `?category=${category}` : ""}`),
  getAlerts: () => request<any[]>("/inventory/alerts"),
  getProducts: () => request<any[]>("/inventory/products"),

  /** Catálogo completo (incluye inactivos) para la pantalla de gestión de
   * Productos — distinto de getProducts(), que es el selector filtrado a
   * activos usado como dropdown en Cotizaciones/Facturas/OPs/Pedidos. */
  getAllProducts: () => request<any[]>("/products"),
  createProduct: (data: {
    sku: string;
    name: string;
    category: string;
    measure?: string;
    unit: string;
    minStock: number;
    unitPrice: number;
  }) => request<any>("/products", { method: "POST", body: JSON.stringify(data) }),
  updateProduct: (
    productId: number,
    data: Partial<{ sku: string; name: string; category: string; measure?: string; unit: string; minStock: number; unitPrice: number }>
  ) => request<any>(`/products/${productId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deactivateProduct: (productId: number) => request<any>(`/products/${productId}`, { method: "DELETE" }),
  reactivateProduct: (productId: number) => request<any>(`/products/${productId}/reactivate`, { method: "POST" }),
  getProductLabel: (productId: number) =>
    request<{ sku: string; name: string; category: string; measure: string | null; unit: string; qrDataUrl: string }>(
      `/products/${productId}/label`
    ),

  getUsers: () => request<any[]>("/users"),
  createUser: (data: { name: string; email: string; password: string; role: string }) =>
    request<any>("/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (userId: number, data: Partial<{ name: string; email: string; role: string; password: string }>) =>
    request<any>(`/users/${userId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deactivateUser: (userId: number) => request<any>(`/users/${userId}`, { method: "DELETE" }),
  reactivateUser: (userId: number) => request<any>(`/users/${userId}/reactivate`, { method: "POST" }),

  getClients: () => request<any[]>("/clients"),
  createClient: (name: string) => request<any>("/clients", { method: "POST", body: JSON.stringify({ name }) }),
  updateClient: (clientId: number, data: { name?: string; contactInfo?: Record<string, unknown>; creditLimit?: number }) =>
    request<any>(`/clients/${clientId}`, { method: "PATCH", body: JSON.stringify(data) }),
  uploadClientAvatar: (clientId: number, file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    return request<any>(`/clients/${clientId}/avatar`, { method: "POST", body: form });
  },
  /** Registra una visita a la ficha del cliente (alimenta el filtro "Frecuentes"). */
  recordClientVisit: (clientId: number) =>
    request<{ viewCount: number; lastViewedAt: string }>(`/clients/${clientId}/visit`, { method: "POST" }),
  deleteClient: (clientId: number) => request<any>(`/clients/${clientId}`, { method: "DELETE" }),
  updateCreditLimit: (clientId: number, creditLimit: number) =>
    request<any>(`/clients/${clientId}/credit-limit`, { method: "PATCH", body: JSON.stringify({ creditLimit }) }),

  getClientContacts: (clientId: number) => request<any[]>(`/clients/${clientId}/contacts`),
  createClientContact: (
    clientId: number,
    data: { name: string; position?: string; phone?: string; email?: string; isPrimary?: boolean }
  ) => request<any>(`/clients/${clientId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
  deleteClientContact: (clientId: number, contactId: number) =>
    request<{ ok: boolean }>(`/clients/${clientId}/contacts/${contactId}`, { method: "DELETE" }),
  updateClientContact: (
    clientId: number,
    contactId: number,
    data: { name: string; position?: string; phone?: string; email?: string; isPrimary?: boolean }
  ) => request<any>(`/clients/${clientId}/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify(data) }),
  /** Lista global de contactos con la empresa relacionada (pantalla CRM "Contactos"). */
  getAllContacts: () => request<any[]>("/clients/contacts"),
  /** Registra una visita a la ficha de un contacto (frecuencia propia del contacto). */
  recordContactVisit: (contactId: number) =>
    request<{ viewCount: number; lastViewedAt: string; cycleInteractions: number }>(
      `/clients/contacts/${contactId}/visit`,
      { method: "POST" }
    ),

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
  getProductionOrder: (id: number) => request<any>(`/production-orders/${id}`),
  createProductionOrder: (data: { productId: number; quantityPlanned: number; measure?: string; notes?: string }) =>
    request<any>("/production-orders", { method: "POST", body: JSON.stringify(data) }),
  getPendingPlanning: () => request<any[]>("/production-orders/pending-planning"),
  createProductionOrderFromPedidoItem: (pedidoVersionItemId: number) =>
    request<any>(`/production-orders/from-pedido-item/${pedidoVersionItemId}`, { method: "POST" }),
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
  submitQualityCheck: (id: number, data: { result: "aprobado" | "rechazado"; observations?: string }) =>
    request<any>(`/production-orders/${id}/quality-check`, { method: "POST", body: JSON.stringify(data) }),

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
    dueDate?: string;
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

  getAuditLog: (params?: { tableName?: string; recordId?: number; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.tableName) qs.set("tableName", params.tableName);
    if (params?.recordId) qs.set("recordId", String(params.recordId));
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ items: any[]; total: number; page: number; pageSize: number }>(`/audit-log${suffix}`);
  },

  getInventoryMovements: (params?: { productId?: number; movementType?: string; page?: number; pageSize?: number }) => {
    const qs = new URLSearchParams();
    if (params?.productId) qs.set("productId", String(params.productId));
    if (params?.movementType) qs.set("movementType", params.movementType);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{ items: any[]; total: number; page: number; pageSize: number }>(`/inventory/movements${suffix}`);
  },

  getWarehouseLocations: () => request<any[]>("/warehouse/locations"),
  createWarehouseLocation: (data: { code: string; label: string }) =>
    request<any>("/warehouse/locations", { method: "POST", body: JSON.stringify(data) }),
  getWarehouseStock: () => request<any[]>("/warehouse/stock"),
  assignWarehouseStock: (data: { productId: number; toLocationId: number; quantity: number; fromLocationId?: number }) =>
    request<any>("/warehouse/assign", { method: "POST", body: JSON.stringify(data) }),
  getWarehouseLocationQr: (id: number) => request<{ dataUrl: string; url: string }>(`/warehouse/locations/${id}/qr`),
  /** Resuelve el token del QR de ubicación (ya escaneado con la cámara) a un
   * locationId, para autocompletar el AssignForm de Almacén. */
  getWarehouseLocationByToken: (token: string) =>
    request<{ id: number; code: string; label: string }>(`/warehouse/locations/by-token/${token}`),
  /** Sin auth (la ruta del token es pública) — igual pasa por `request()`,
   * el Authorization que agrega si hay sesión no molesta al backend. */
  getPublicLocation: (token: string) =>
    request<{ location: { code: string; label: string }; items: any[] }>(`/public/locations/${token}`),

  getDashboardResumen: () =>
    request<{
      ventasDelMes: number;
      ventasMesAnterior: number;
      cambioVentasPct: number | null;
      ventasUltimos6Meses: { mes: string; total: number }[];
      carteraPendiente: number;
      carteraVencida: number;
      facturasConSaldo: number;
      opsEnCurso: number;
      pedidosEnProduccion: number;
      cotizacionesAbiertas: number;
      topClientesSaldo: { clientId: number; name: string; saldo: number }[];
    }>("/dashboard/resumen"),

  getNotifications: () => request<any[]>("/notifications"),
  getUnreadNotificationCount: () => request<{ count: number }>("/notifications/unread-count"),
  markNotificationRead: (id: number) => request<any>(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllNotificationsRead: () => request<{ ok: boolean }>("/notifications/read-all", { method: "PATCH" }),

  getDashboardIndicadores: () =>
    request<{
      topProductosDespachados: { productId: number; sku: string; name: string; unit: string; total: number }[];
      calidad: { aprobadas: number; rechazadas: number; pctAprobacion: number | null };
      tiempoPromedioProduccionHoras: number | null;
    }>("/dashboard/indicadores"),

  /** Mismo patrón crudo que downloadPedidoAttachment (fetch + blob + <a
   * download>) — el .xlsx generado no es JSON, no pasa por request(). */
  downloadExport: async (resource: "inventario" | "pedidos" | "facturas" | "clientes") => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/export/${resource}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Error ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${resource}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
