import { getToken } from "../token.ts";

let _onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void): void {
  _onUnauthorized = fn;
}

export function clearUnauthorizedHandler(): void {
  _onUnauthorized = null;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(url: string, method: string, body?: unknown): Promise<{ data: T }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const instanceId = globalThis.__USER__?.instanceId;
  if (instanceId) headers["X-Instance-Id"] = instanceId;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 401) {
    _onUnauthorized?.();
  }

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  // 204 No Content — nothing to parse
  if (response.status === 204) {
    return { data: undefined as T };
  }

  const data = (await response.json()) as T;
  return { data };
}

async function uploadFile<T>(url: string, formData: FormData): Promise<{ data: T }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const instanceId = globalThis.__USER__?.instanceId;
  if (instanceId) headers["X-Instance-Id"] = instanceId;
  // Do NOT set Content-Type — the browser must set it with the multipart boundary.
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
    credentials: "include",
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 401) {
    _onUnauthorized?.();
  }

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  const data = (await response.json()) as T;
  return { data };
}

export const api = {
  get: <T>(url: string) => request<T>(url, "GET"),
  post: <T>(url: string, body?: unknown) => request<T>(url, "POST", body),
  put: <T>(url: string, body?: unknown) => request<T>(url, "PUT", body),
  patch: <T>(url: string, body?: unknown) => request<T>(url, "PATCH", body),
  delete: <T>(url: string) => request<T>(url, "DELETE"),
  upload: <T>(url: string, formData: FormData) => uploadFile<T>(url, formData),
};
