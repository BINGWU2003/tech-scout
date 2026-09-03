import { type AuthSession, type User } from '@tech-scout/contracts'
import { create } from 'zustand'

interface AuthState {
  auth: {
    user: User | null
    csrfToken: string
    setSession: (session: AuthSession) => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => {
  return {
    auth: {
      user: null,
      csrfToken: '',
      setSession: ({ user, csrfToken }) =>
        set((state) => ({
          ...state,
          auth: { ...state.auth, user, csrfToken },
        })),
      reset: () =>
        set((state) => ({
          ...state,
          auth: { ...state.auth, user: null, csrfToken: '' },
        })),
    },
  }
})
