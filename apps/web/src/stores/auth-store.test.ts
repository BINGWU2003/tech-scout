import { beforeEach, describe, expect, it, vi } from 'vitest'

const session = {
  user: {
    id: '8a77bdee-31f4-44e6-ae3a-5a647f8cbada',
    username: 'alice',
    email: 'alice@example.com',
    role: 'user' as const,
    status: 'active' as const,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    lastLoginAt: null,
  },
  csrfToken: 'csrf-token-that-is-long-enough-for-the-contract',
}

beforeEach(() => vi.resetModules())

describe('useAuthStore', () => {
  it('keeps authentication state in memory', async () => {
    const { useAuthStore } = await import('./auth-store')
    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.csrfToken).toBe('')

    useAuthStore.getState().auth.setSession(session)
    expect(useAuthStore.getState().auth.user).toEqual(session.user)
    expect(useAuthStore.getState().auth.csrfToken).toBe(session.csrfToken)
  })

  it('clears user and csrf state together', async () => {
    const { useAuthStore } = await import('./auth-store')
    useAuthStore.getState().auth.setSession(session)
    useAuthStore.getState().auth.reset()
    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.csrfToken).toBe('')
  })
})
