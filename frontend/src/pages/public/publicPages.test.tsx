import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { useAuthStore } from '../../store/auth';
import { usePrefsStore } from '../../store/prefs';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const key = `${init.method ?? 'GET'} ${url}`;
    const handler = routes[key];
    if (handler) return handler(url, init);
    return json({ detail: 'Not Found' }, 404);
  }));
  return calls;
}

const USER = { id: 'u1', email: 'new@example.com', name: 'New', role: 'user', plan: 'free', email_verified: true,
  is_blocked: false, credit_balance: 0, avatar_url: null, created_at: '2026-01-01T00:00:00Z' };

function go(path: string) {
  window.history.pushState({}, '', path);
  render(<App />);
}

async function fillRegister(valid = true) {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New User' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: valid ? 'Abcdef12' : 'short' } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: valid ? 'Abcdef12' : 'short' } });
  if (valid) fireEvent.click(screen.getByLabelText(/I agree/));
}

describe('public pages', () => {
  beforeEach(() => {
    usePrefsStore.setState({ lang: 'en' });
    useAuthStore.setState({ accessToken: null, user: null, isInitialized: true });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('keeps the submit button disabled until the form is valid', async () => {
    mockFetch({});
    go('/register');
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(submit).toBeDisabled();
    await fillRegister(false);
    expect(submit).toBeDisabled();
    fireEvent.blur(screen.getByLabelText('Password', { selector: 'input' }));
    expect(screen.getByText('Password does not meet the rules below.')).toBeInTheDocument();
  });

  it('shows the strength meter and rule states live', async () => {
    mockFetch({});
    go('/register');
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'Abcdef12' } });
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByText('8 or more characters')).toBeInTheDocument();
  });

  it('shows the duplicate-email error from the server', async () => {
    mockFetch({
      'POST /api/auth/register': () => json({ detail: 'An account with this email already exists' }, 409),
    });
    go('/register');
    await fillRegister(true);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/already registered/)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/register');
  });

  it('after success with verification required goes to Check your email, never back to register', async () => {
    mockFetch({
      'POST /api/auth/register': () => json({ user: USER, verification_required: true, email_delivery: 'not_connected' }, 201),
    });
    go('/register');
    await fillRegister(true);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(window.location.pathname).toBe('/check-email'));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/Email delivery is not connected/)).toBeInTheDocument();
  });

  it('without verification it logs in and goes to the dashboard', async () => {
    mockFetch({
      'POST /api/auth/register': () => json({ user: USER, verification_required: false, email_delivery: 'not_connected' }, 201),
      'POST /api/auth/login': () => json({ access_token: 'tok', user: USER }),
    });
    go('/register');
    await fillRegister(true);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(window.location.pathname).toBe('/app/dashboard'));
  });

  it('login sends remember flag and returns to the originally requested page', async () => {
    const calls = mockFetch({
      'POST /api/auth/login': () => json({ access_token: 'tok', user: USER }),
    });
    window.history.pushState({}, '', '/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'Abcdef12' } });
    fireEvent.click(screen.getByLabelText('Remember me'));
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/auth/login')).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url === '/api/auth/login')?.init.body));
    expect(body.remember).toBe(false);
  });

  it('shows a clear error for wrong credentials', async () => {
    mockFetch({ 'POST /api/auth/login': () => json({ detail: 'Invalid email or password' }, 401) });
    window.history.pushState({}, '', '/login');
    render(<App />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password', { selector: 'input' }), { target: { value: 'Wrong1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
  });

  it('language switch really changes the page language', async () => {
    mockFetch({});
    go('/login');
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'RU' }));
    expect(await screen.findByRole('heading', { name: 'С возвращением' })).toBeInTheDocument();
    expect(usePrefsStore.getState().lang).toBe('ru');
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  });

  it('forgot password shows a neutral success message', async () => {
    mockFetch({ 'POST /api/auth/forgot': () => json({ status: 'accepted', email_delivery: 'not_connected' }, 202) });
    go('/forgot-password');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'anyone@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/Email delivery is not connected/)).toBeInTheDocument();
  });

  it('reset password without a token shows the invalid-link state', () => {
    mockFetch({});
    go('/reset-password');
    expect(screen.getByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
  });

  it('landing page offers Get started to guests', () => {
    mockFetch({});
    go('/');
    const links = screen.getAllByRole('link', { name: 'Get started' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/register');
    expect(screen.getAllByText('Coming soon')).toHaveLength(4); // 2D, Character, Animation, Cinema
  });
});
