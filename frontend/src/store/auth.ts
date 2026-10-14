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
  /** true once the initial session restore has finished (success or not). */
  ready: boolean;
  setSession: (token: string, user: User) => void;
  setUser: (user: User) => void;
  clear: () => void;
  setReady: () => void;
}

// The access token lives in memory only. The refresh token is an httpOnly cookie.
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  user: null,
  ready: false,
  setSession: (accessToken, user) => set({ accessToken, user }),
  setUser: (user) => set({ user }),
  clear: () => set({ accessToken: null, user: null }),
  setReady: () => set({ ready: true }),
}));
