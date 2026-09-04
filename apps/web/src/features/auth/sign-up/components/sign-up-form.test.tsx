import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SignUpForm } from './sign-up-form'

const navigate = vi.hoisted(() => vi.fn())
const register = vi.hoisted(() => vi.fn())
const setSession = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth-api', () => ({ authApi: { register } }))
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

describe('SignUpForm 注册表单', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    register.mockResolvedValue(session)
  })

  it('要求填写用户名、邮箱和一致的密码', async () => {
    const screen = await render(<SignUpForm />)
    await userEvent.click(screen.getByRole('button', { name: '注册并登录' }))
    await expect
      .element(screen.getByText('用户名至少需要 3 个字符'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('请输入有效的邮箱地址'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('密码至少需要 10 个字符'))
      .toBeInTheDocument()
  })

  it('完成注册并存储返回的会话', async () => {
    const screen = await render(<SignUpForm />)
    await userEvent.fill(screen.getByLabelText('用户名'), 'Alice_01')
    await userEvent.fill(screen.getByLabelText('邮箱'), 'Alice@Example.com')
    await userEvent.fill(
      screen.getByRole('textbox', { name: '密码', exact: true }),
      'correct horse battery staple'
    )
    await userEvent.fill(
      screen.getByRole('textbox', { name: '确认密码', exact: true }),
      'correct horse battery staple'
    )
    await userEvent.click(screen.getByRole('button', { name: '注册并登录' }))

    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce())
    expect(register).toHaveBeenCalledWith({
      username: 'alice_01',
      email: 'Alice@Example.com',
      password: 'correct horse battery staple',
    })
    expect(setSession).toHaveBeenCalledWith(session)
    expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
  })
})
