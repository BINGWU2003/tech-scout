import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'

const navigate = vi.hoisted(() => vi.fn())
const login = vi.hoisted(() => vi.fn())
const setSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth-api', () => ({ authApi: { login } }))
vi.mock('@/lib/handle-server-error', () => ({ handleServerError: vi.fn() }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth: { setSession } }),
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

const session = {
  user: {
    id: '20dc77de-18a7-4439-9362-04d822e289e9',
    username: 'alice',
    email: 'alice@example.com',
    role: 'user',
    status: 'active',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    lastLoginAt: null,
  },
  csrfToken: 'csrf-token',
}

describe('UserAuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    login.mockResolvedValue(session)
  })

  it('requires an identifier and password', async () => {
    const screen = await render(<UserAuthForm />)
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    await expect
      .element(screen.getByText('请输入用户名或邮箱'))
      .toBeInTheDocument()
    await expect.element(screen.getByText('请输入密码')).toBeInTheDocument()
  })

  it('stores the server session and follows a local redirect', async () => {
    const screen = await render(<UserAuthForm redirectTo='/settings' />)
    await userEvent.fill(screen.getByLabelText('用户名或邮箱'), 'Alice')
    await userEvent.fill(screen.getByLabelText('密码'), 'a secure password')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce())
    expect(login).toHaveBeenCalledWith({
      identifier: 'Alice',
      password: 'a secure password',
    })
    expect(setSession).toHaveBeenCalledWith(session)
    expect(navigate).toHaveBeenCalledWith({ to: '/settings', replace: true })
  })
})
