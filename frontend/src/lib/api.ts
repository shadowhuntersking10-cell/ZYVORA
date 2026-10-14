import { useAuthStore, type User } from '../store/auth';

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

export interface ApiOptions {
  method?: Method;
  body?: unknown;
  /** Send the Bearer access token (default true). Login/register/verify use false. */
  auth?: boolean;
  /** Allow one refresh + retry on 401 (default true). */
  retry?: boolean;
}

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

/** The single in-flight refresh. Concurrent 401s share it, so the rotating refresh cookie is used once at a time. */
let refreshing: Promise<boolean> | null = null;

/**
 * Restores the session from the httpOnly refresh cookie.
 *
 * The session is cleared ONLY when the server says the refresh token is invalid (401/403)
 * and no newer login/logout happened while the request was in flight.
 * Network errors and 5xx never log the user out.
 */
export function refreshSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  const startEpoch = useAuthStore.getState().epoch;
  const request: Promise<boolean> = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      const store = useAuthStore.getState();
      if (store.epoch !== startEpoch) {
        // A login or logout happened after this request started. That newer state wins.
        return store.user !== null;
      }
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) store.clear();
        return false;
      }
      const body = (await r.json()) as { access_token: string; user: User };
      useAuthStore.getState().setSession(body.access_token, body.user);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (refreshing === request) refreshing = null;
    });
  refreshing = request;
  return request;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, retry = true } = opts;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const sentToken = useAuthStore.getState().accessToken;
  if (auth && sentToken) headers.Authorization = `Bearer ${sentToken}`;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry && path !== '/api/auth/refresh') {
    const currentToken = useAuthStore.getState().accessToken;
    // The token changed while this request was in flight (refresh or new login): retry with it.
    if (currentToken && currentToken !== sentToken) return api<T>(path, { ...opts, retry: false });
    if (await refreshSession()) return api<T>(path, { ...opts, retry: false });
    // Refresh failed: refreshSession has cleared the session and the route guard sends the user to /login.
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text; // non-JSON error bodies (e.g. a proxy 502 page) must not crash the caller
    }
  }
  if (!res.ok) {
    const detail = data && typeof data === 'object' && 'detail' in data ? (data as { detail: unknown }).detail : data;
    throw new ApiError(res.status, messageFrom(detail, `Request failed (${res.status})`), detail);
  }
  return data as T;
}
