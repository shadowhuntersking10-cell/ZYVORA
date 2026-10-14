import { useAuthStore } from '../store/auth';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function messageFrom(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'message' in detail && typeof (detail as { message: unknown }).message === 'string') {
    return (detail as { message: string }).message;
  }
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object' && 'msg' in detail[0]) {
    return String((detail[0] as { msg: unknown }).msg);
  }
  return fallback;
}

let refreshing: Promise<boolean> | null = null;

/** Refreshes the access token using the httpOnly refresh cookie. Shared between concurrent calls. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) {
          useAuthStore.getState().clear();
          return false;
        }
        const body = (await r.json()) as { access_token: string; user: import('../store/auth').User };
        useAuthStore.getState().setSession(body.access_token, body.user);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: Method; body?: unknown; auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, retry = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = useAuthStore.getState().accessToken;
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry && path !== '/api/auth/refresh') {
    const ok = await refreshSession();
    if (ok) return api<T>(path, { method, body, auth, retry: false });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? (data as { detail: unknown }).detail : data;
    throw new ApiError(res.status, messageFrom(detail, `Request failed (${res.status})`), detail);
  }
  return data as T;
}
