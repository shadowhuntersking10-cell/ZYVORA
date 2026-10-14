/**
 * Regression tests for "logged in, then bounced back to /login about a second later".
 *
 * The fake server below behaves like the real API for the parts that matter here:
 *  - the refresh token is an httpOnly cookie that the browser sends with each request
 *    (the cookie value is captured when the request is SENT, like a browser does),
 *  - refresh tokens rotate, so a refresh that uses an old cookie gets 401,
 *  - access tokens are Bearer tokens checked on protected routes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { api, ApiError, refreshSession } from '../lib/api';
import { loginRequest } from '../pages/public/AuthPages';
import { useAuthStore } from '../store/auth';

const EMAIL = 'stay@example.com';
const PASSWORD = 'Sup3rSecret-pass';
const USER = {
  id: 'u-1', email: EMAIL, name: 'Stay User', role: 'user', plan: 'free', email_verified: true,
  is_blocked: false, credit_balance: 0, avatar_url: null, created_at: '2026-01-01T00:00:00Z',
};

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function fakeServer(opts: { refreshDelayMs?: number } = {}) {
  let refreshCookie: string | null = null; // the cookie as the browser holds it right now
  let seq = 0;
  const liveAccess = new Set<string>();
  const requests: string[] = [];
  const newAccess = () => {
    const token = `access-${++seq}`;
    liveAccess.add(token);
    return token;
  };
  const bearerOk = (init: RequestInit) => {
    const m = /^Bearer (.+)$/.exec(new Headers(init.headers).get('authorization') ?? '');
    return m !== null && liveAccess.has(m[1] ?? "");
  };

  const fetchFn = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const method = init.method ?? 'GET';
    requests.push(`${method} ${path}`);
    const sentCookie = refreshCookie; // what the browser attached to this request

    if (path === '/api/auth/login' && method === 'POST') {
      const body = JSON.parse(String(init.body)) as { email: string; password: string };
      if (body.email !== EMAIL || body.password !== PASSWORD) return json(401, { detail: 'Invalid email or password' });
      refreshCookie = `rt-${++seq}`;
      return json(200, { access_token: newAccess(), token_type: 'bearer', user: USER });
    }
    if (path === '/api/auth/refresh' && method === 'POST') {
      if (opts.refreshDelayMs) await new Promise((r) => setTimeout(r, opts.refreshDelayMs));
      if (!sentCookie || sentCookie !== refreshCookie) return json(401, { detail: 'No session' });
      refreshCookie = `rt-${++seq}`; // rotation
      return json(200, { access_token: newAccess(), token_type: 'bearer', user: USER });
    }
    if (path === '/api/auth/logout') {
      refreshCookie = null;
      return new Response(null, { status: 204 });
    }
    if (path === '/api/auth/me' || path === '/api/projects' || path === '/api/ai/jobs') {
      if (!bearerOk(init)) return json(401, { detail: 'Invalid or expired token' });
      return json(200, path === '/api/auth/me' ? USER : []);
    }
    return json(404, { detail: 'Not found' });
  };

  return {
    fetch: vi.fn(fetchFn),
    requests,
    expireAccessTokens: () => liveAccess.clear(),
    cookie: () => refreshCookie,
  };
}

/** What a page reload does to memory: the access token and user are gone, the cookie stays. */
function resetInMemoryState() {
  useAuthStore.setState({ accessToken: null, user: null, isInitialized: false });
}

describe('session persistence', () => {
  beforeEach(() => {
    resetInMemoryState();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetInMemoryState();
    window.history.pushState({}, '', '/');
  });

  it('login stays signed in after 5 seconds and after a page refresh', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    window.history.pushState({}, '', '/login');
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(window.location.pathname).toBe('/app/dashboard'));
    expect(useAuthStore.getState().user?.email).toBe(EMAIL);

    // Stay on the dashboard for 5 seconds. Nothing may redirect to /login.
    const seen: string[] = [];
    const watch = setInterval(() => seen.push(window.location.pathname), 100);
    await new Promise((r) => setTimeout(r, 5000));
    clearInterval(watch);
    expect(seen.every((p) => p === '/app/dashboard')).toBe(true);
    expect(useAuthStore.getState().user?.email).toBe(EMAIL);

    // Page refresh: unmount, lose in-memory state, boot the app again on the dashboard URL.
    const requestsBeforeReload = server.requests.length;
    cleanup();
    resetInMemoryState();
    window.history.pushState({}, '', '/app/dashboard');
    render(<App />);
    await waitFor(() => expect(useAuthStore.getState().user?.email).toBe(EMAIL));
    expect(window.location.pathname).toBe('/app/dashboard');
    // After the reload the boot restore uses the cookie once, and the user is never sent to /login.
    const afterReload = server.requests.slice(requestsBeforeReload);
    expect(afterReload.filter((r) => r === 'POST /api/auth/refresh')).toHaveLength(1);
    expect(afterReload).not.toContain('GET /api/auth/login');
  }, 20_000);

  it('a boot-time refresh that answers after a login does not log the user out', async () => {
    // Root cause regression: the App boot calls refreshSession() before the user logs in.
    // Its request carries no cookie, so the server answers 401 late, after the login has succeeded.
    const server = fakeServer({ refreshDelayMs: 300 });
    vi.stubGlobal('fetch', server.fetch);

    const boot = refreshSession();
    await loginRequest(EMAIL, PASSWORD, true);
    expect(useAuthStore.getState().user?.email).toBe(EMAIL);

    await boot;
    expect(useAuthStore.getState().user?.email).toBe(EMAIL);
    await expect(api('/api/projects')).resolves.toEqual([]);
  });

  it('a 401 on a protected call refreshes once, retries, and keeps the user signed in', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    await loginRequest(EMAIL, PASSWORD, true);
    server.expireAccessTokens();

    await expect(api('/api/projects')).resolves.toEqual([]);
    expect(server.requests.slice(-3)).toEqual(['GET /api/projects', 'POST /api/auth/refresh', 'GET /api/projects']);
    expect(useAuthStore.getState().user?.email).toBe(EMAIL);
  });

  it('when the refresh also fails, the session is cleared once and there is no retry loop', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    await loginRequest(EMAIL, PASSWORD, true);
    server.expireAccessTokens();
    await api('/api/auth/logout', { method: 'POST', auth: false });

    await expect(api('/api/projects')).rejects.toBeInstanceOf(ApiError);
    expect(server.requests.filter((r) => r === 'POST /api/auth/refresh')).toHaveLength(1);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('server errors, forbidden responses and network failures never log the user out', async () => {
    const server = fakeServer();
    vi.stubGlobal('fetch', server.fetch);
    await loginRequest(EMAIL, PASSWORD, true);

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/projects') return json(500, { detail: 'Internal server error' });
      if (path === '/api/ai/jobs') return json(403, { detail: 'Account is blocked' });
      if (path === '/api/auth/me') throw new TypeError('Failed to fetch');
      return server.fetch(input, init);
    }));

    await expect(api('/api/projects')).rejects.toMatchObject({ status: 500 });
    await expect(api('/api/ai/jobs')).rejects.toMatchObject({ status: 403 });
    await expect(api('/api/auth/me')).rejects.toBeInstanceOf(TypeError);
    expect(useAuthStore.getState().user?.email).toBe(EMAIL);
  });
});
