const API_BASE = (import.meta.env.VITE_ADMIN_API_BASE || "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function buildUrl(path, query) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = API_BASE || "";
  const absoluteUrl = /^https?:\/\//i.test(base);
  const basePath = absoluteUrl ? base : `${window.location.origin}${base}`;
  const url = new URL(`${basePath}${normalizedPath}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value == null || value === "") {
        return;
      }
      url.searchParams.set(key, String(value));
    });
  }
  if (!base) {
    return `${url.pathname}${url.search}`;
  }
  if (absoluteUrl) {
    return `${url.origin}${url.pathname}${url.search}`;
  }
  return `${url.pathname}${url.search}`;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

async function request(path, options = {}) {
  const {
    method = "GET",
    query,
    body,
    formData,
    csrfToken,
    headers = {},
  } = options;
  const url = buildUrl(path, query);
  const requestHeaders = new Headers(headers);

  if (csrfToken) {
    requestHeaders.set("x-csrf-token", csrfToken);
  }

  let payload = undefined;
  if (formData) {
    payload = formData;
  } else if (body != null) {
    requestHeaders.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: requestHeaders,
    body: payload,
  });

  const data = await parseResponse(response);
  if (!response.ok) {
    const message = data?.error || `HTTP ${response.status}`;
    throw new ApiError(message, response.status, data);
  }
  return data;
}

export const api = {
  me() {
    return request("/admin/me");
  },
  login(username, password) {
    return request("/admin/auth/login", {
      method: "POST",
      body: { username, password },
    });
  },
  logout(csrfToken) {
    return request("/admin/auth/logout", {
      method: "POST",
      csrfToken,
    });
  },
  getProducts(params) {
    return request("/admin/products", {
      query: params,
    });
  },
  getProduct(skuId, includeHistory = false) {
    return request(`/admin/products/${skuId}`, {
      query: includeHistory ? { include_history: "on" } : undefined,
    });
  },
  updateProduct(skuId, payload, csrfToken) {
    return request(`/admin/products/${skuId}`, {
      method: "PUT",
      body: payload,
      csrfToken,
    });
  },
  importProducts(formData, csrfToken) {
    return request("/admin/import/products", {
      method: "POST",
      formData,
      csrfToken,
    });
  },
  importPrices(formData, csrfToken) {
    return request("/admin/import/prices", {
      method: "POST",
      formData,
      csrfToken,
    });
  },
  getTopSellers(params) {
    return request("/admin/enrichment/top-sellers", {
      query: params,
    });
  },
  applyRules(payload, csrfToken) {
    return request("/admin/enrichment/apply-rules", {
      method: "POST",
      body: payload,
      csrfToken,
    });
  },
  listEnrichmentRules() {
    return request("/admin/enrichment/rules");
  },
  createEnrichmentRule(payload, csrfToken) {
    return request("/admin/enrichment/rules", {
      method: "POST",
      body: payload,
      csrfToken,
    });
  },
  updateEnrichmentRule(ruleId, payload, csrfToken) {
    return request(`/admin/enrichment/rules/${ruleId}`, {
      method: "PUT",
      body: payload,
      csrfToken,
    });
  },
  triggerSkuEmbeddingSync(payload, csrfToken) {
    return request("/api/search/skus/sync", {
      method: "POST",
      body: payload,
      csrfToken,
    });
  },
  listSkuEmbeddingSyncJobs(params) {
    return request("/api/search/skus/sync/jobs", {
      query: params,
    });
  },
  getSkuEmbeddingSyncJob(jobId, params) {
    return request(`/api/search/skus/sync/jobs/${jobId}`, {
      query: params,
    });
  },
  cancelSkuEmbeddingSyncJob(jobId, csrfToken) {
    return request(`/api/search/skus/sync/jobs/${jobId}/cancel`, {
      method: "POST",
      csrfToken,
    });
  },
};
