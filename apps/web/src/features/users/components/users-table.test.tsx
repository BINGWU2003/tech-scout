import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { UsersTable } from './users-table'

const routeMocks = vi.hoisted(() => ({
  search: { page: 1, pageSize: 20 },
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: () => ({
    useSearch: () => routeMocks.search,
    useNavigate: () => routeMocks.navigate,
  }),
}))

describe('UsersTable 用户表格', () => {
  beforeEach(() => vi.clearAllMocks())

  it('输入搜索内容后立即显示重置按钮', async () => {
    const screen = await render(
      <UsersTable
        data={[]}
        pageCount={1}
        isLoading={false}
        onAction={vi.fn()}
      />
    )

    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .not.toBeInTheDocument()

    const searchInput = screen.getByPlaceholder('搜索用户名或邮箱')
    await userEvent.fill(searchInput, 'alice')

    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '重置' }))

    await expect.element(searchInput).toHaveValue('')
    await expect
      .element(screen.getByRole('button', { name: '重置' }))
      .not.toBeInTheDocument()
  })
})
