import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SignOutDialog } from './sign-out-dialog'

const navigate = vi.hoisted(() => vi.fn())
const logout = vi.hoisted(() => vi.fn())
const reset = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth-api', () => ({ authApi: { logout } }))
vi.mock('@/lib/handle-server-error', () => ({ handleServerError: vi.fn() }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({ auth: { reset } }),
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  useLocation: () => ({ href: '/dashboard?tab=1' }),
}))

describe('SignOutDialog 退出登录对话框', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    logout.mockResolvedValue(undefined)
  })

  it('在清除本地状态前撤销服务器会话', async () => {
    const screen = await render(<SignOutDialog open onOpenChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '退出' }))
    await vi.waitFor(() => expect(logout).toHaveBeenCalledOnce())
    expect(reset).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith({
      to: '/sign-in',
      search: { redirect: '/dashboard?tab=1' },
      replace: true,
    })
  })
})
