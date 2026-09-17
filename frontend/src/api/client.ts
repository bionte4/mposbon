import { env, tenantSlugForRequest } from '../config/env';
import { ApiError } from './errors';
import { parseApiError } from './parse-error';

export { ApiError, isOfflineError } from './errors';
export { parseApiError } from './parse-error';

type AuthHeaders = {
  accessToken?: string | null;
  userId?: string | null;
  userEmail?: string | null;
};

type RequestOptions = {
  /** Skip global error toasts (sync queue handles its own UX). */
  silent?: boolean;
};

let authHeaders: AuthHeaders = {};
let toastHandler: ((title: string, message?: string) => void) | null = null;

export function setApiAuth(headers: AuthHeaders): void {
  authHeaders = { ...authHeaders, ...headers };
}

export function clearApiAuth(): void {
  authHeaders = {};
}

/** Wire once from main.ts so API failures surface as toasts without freezing UI. */
export function setApiToastHandler(handler: (title: string, message?: string) => void): void {
  toastHandler = handler;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const response = await rawRequest(method, path, body, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function rawRequest(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Tenant-Slug': tenantSlugForRequest(),
    'X-Request-Id': crypto.randomUUID(),
  };
  if (authHeaders.accessToken) {
    headers.Authorization = `Bearer ${authHeaders.accessToken}`;
  }
  if (authHeaders.userId) {
    headers['X-User-Id'] = authHeaders.userId;
  }
  if (authHeaders.userEmail) {
    headers['X-User-Email'] = authHeaders.userEmail;
  }

  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const err = new ApiError('Network unavailable', 0);
    if (!options?.silent) {
      const parsed = parseApiError(err);
      toastHandler?.(parsed.title, parsed.message);
    }
    throw err;
  }

  if (!response.ok) {
    const text = await response.text();
    const err = new ApiError(text || response.statusText, response.status);
    let skipToast = Boolean(options?.silent);
    try {
      const json = JSON.parse(text) as { code?: string };
      if (response.status === 409 && json.code === 'STOCK_CONFLICT') {
        skipToast = true;
      }
    } catch {
      // non-JSON body
    }
    if (!skipToast) {
      const parsed = parseApiError(err);
      toastHandler?.(parsed.title, parsed.message);
    }
    throw err;
  }
  return response;
}

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export function apiPost<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('POST', path, body, options);
}

export function apiPut<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PUT', path, body, options);
}

export function apiPatch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PATCH', path, body, options);
}

export function apiDelete<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('DELETE', path, undefined, options);
}

/** Download binary/text responses (CSV exports). */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const response = await rawRequest('GET', path);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
