import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  plan: string;
  email_verified: boolean;
  is_blocked: boolean;
  credit_balance: number;
  avatar_url: string | null;
  created_at: string;
}

interface AuthState {
  accessToken: string | null;
  user: User | null;
  /** true once the initial session restore has finished (success or not), or a login succeeded. */
  isInitialized: boolean;
  /**
   * Increments on every session change (login, refresh, logout).
   * Async work that started before a change compares this to detect that its result is stale,
   * so an old 401 can never wipe a session that was created afterwards.
   */
  epoch: number;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  clear: () => void;
  setReady: () => void;
}

// The access token lives in memory only. The refresh token is an httpOnly cookie.
// The session is restored on every page load through POST /api/auth/refresh, so a reload keeps the user signed in.
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  isInitialized: false,
  epoch: 0,
  setSession: (accessToken, user) => set((s) => ({ accessToken, user, isInitialized: true, epoch: s.epoch + 1 })),
  setUser: (user) => set({ user }),
  clear: () => set((s) => ({ accessToken: null, user: null, epoch: s.epoch + 1 })),
  setReady: () => set({ isInitialized: true }),
}));
