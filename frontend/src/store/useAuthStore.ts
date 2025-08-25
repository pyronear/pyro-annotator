import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { User } from '@/types/api';
import { apiClient } from '@/services/api';

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
  
  // Computed properties
  isSuperuser: () => boolean;
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

            const response = await apiClient.login({ username, password });
            
            // Store token first so getCurrentUser can use it
            set(
              {
                token: response.access_token,
                isAuthenticated: true,
              },
              false,
              'login:token_received'
            );

            // Fetch user information using the token
            const user = await apiClient.getCurrentUser();

            set(
              {
                user: user,
                token: response.access_token,
                isAuthenticated: true,
                isLoading: false,
                error: null,
              },
              false,
              'login:success'
            );
          } catch (error: any) {
            set(
              {
                user: null,
                token: null,
                isAuthenticated: false,
                isLoading: false,
                error: error?.detail || error?.message || 'Login failed',
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

        initializeAuth: async () => {
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
                // Token still valid, fetch fresh user info
                try {
                  const user = await apiClient.getCurrentUser();
                  set(
                    { 
                      isAuthenticated: true,
                      user: user
                    }, 
                    false, 
                    'initializeAuth:restored'
                  );
                } catch (error) {
                  // Failed to fetch user info, logout
                  get().logout();
                }
              }
            } catch (error) {
              // Invalid token format, logout
              get().logout();
            }
          }
        },

        // Computed properties
        isSuperuser: () => {
          const { user } = get();
          return user?.is_superuser || false;
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