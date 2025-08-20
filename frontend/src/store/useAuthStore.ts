import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

interface User {
  username: string;
}

interface AuthStore {
  // State
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  initializeAuth: () => void;
}

export const useAuthStore = create<AuthStore>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,

        // Actions
        login: async (username: string, password: string) => {
          try {
            set({ isLoading: true, error: null }, false, 'login:start');

            const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5050';
            const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ username, password }),
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({ detail: 'Login failed' }));
              throw new Error(errorData.detail || 'Login failed');
            }

            const data = await response.json();
            const { access_token } = data;

            set(
              {
                user: { username },
                token: access_token,
                isAuthenticated: true,
                isLoading: false,
                error: null,
              },
              false,
              'login:success'
            );
          } catch (error) {
            set(
              {
                user: null,
                token: null,
                isAuthenticated: false,
                isLoading: false,
                error: error instanceof Error ? error.message : 'Login failed',
              },
              false,
              'login:error'
            );
            throw error;
          }
        },

        logout: () => {
          set(
            {
              user: null,
              token: null,
              isAuthenticated: false,
              isLoading: false,
              error: null,
            },
            false,
            'logout'
          );
        },

        setLoading: (loading: boolean) =>
          set({ isLoading: loading }, false, 'setLoading'),

        setError: (error: string | null) =>
          set({ error }, false, 'setError'),

        clearError: () =>
          set({ error: null }, false, 'clearError'),

        initializeAuth: () => {
          const { token } = get();
          if (token) {
            // Verify token is still valid by checking if it's expired
            try {
              const payload = JSON.parse(atob(token.split('.')[1]));
              const now = Date.now() / 1000;
              
              if (payload.exp && payload.exp < now) {
                // Token expired, logout
                get().logout();
              } else {
                // Token still valid, restore authentication state
                set(
                  { 
                    isAuthenticated: true,
                    user: { username: payload.sub }
                  }, 
                  false, 
                  'initializeAuth:restored'
                );
              }
            } catch (error) {
              // Invalid token format, logout
              get().logout();
            }
          }
        },
      }),
      {
        name: 'auth-store',
        partialize: (state) => ({ 
          token: state.token,
          user: state.user,
          isAuthenticated: state.isAuthenticated 
        }),
      }
    ),
    {
      name: 'auth-store',
    }
  )
);