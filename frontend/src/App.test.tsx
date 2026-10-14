import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { useAuthStore } from './store/auth';

describe('App shell routing', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAuthStore.getState().clear();
    window.history.pushState({}, '', '/');
  });

  it('sends an anonymous visitor to the login page after the session restore fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'No session' }), { status: 401 })));
    window.history.pushState({}, '', '/app/dashboard');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('shows the login form with labelled fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    window.history.pushState({}, '', '/login');
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Email')).toBeInTheDocument());
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
});
