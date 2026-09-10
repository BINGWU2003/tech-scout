import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { type LibraryKind, type LibrarySearch } from './library-navigation'
import { LibraryPage } from './library-page'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  navigate: vi.fn(),
  locationState: {} as Record<string, unknown>,
}))

vi.mock('@/lib/api-client', () => ({ apiRequest: mocks.request }))
vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => (
    <header>{children}</header>
  ),
}))
vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))
vi.mock('@/components/search', () => ({ Search: () => null }))
vi.mock('@/components/theme-switch', () => ({ ThemeSwitch: () => null }))
vi.mock('@/components/config-drawer', () => ({ ConfigDrawer: () => null }))
vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => null,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useLocation: ({ select }: { select: (location: unknown) => unknown }) =>
    select({ state: mocks.locationState }),
  useNavigate: () => mocks.navigate,
}))

const patent = {
  id: 'CNTESTA1',
  name: '固态电池专利',
  date: '2025-01-01',
  creditCode: null,
  currentAssignees: ['示例企业'],
  originalAssignees: ['原始申请人'],
  sources: [
    {
      runId: 'c81705e4-0a56-4f34-a42b-10c64ac5c338',
      status: 'paused',
      directions: ['固态电池'],
      observedAt: '2025-01-01T00:00:00.000Z',
      url: 'https://patents.google.com/patent/CNTESTA1',
      sha256: null,
    },
  ],
  updatedAt: '2025-01-01T00:00:00.000Z',
}

function renderLibrary(
  options: {
    kind?: LibraryKind
    search?: LibrarySearch
    onSearchChange?: (search: LibrarySearch, replace?: boolean) => void
  } = {}
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LibraryPage
        kind={options.kind ?? 'patents'}
        search={options.search ?? {}}
        onSearchChange={options.onSearchChange ?? vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('累计数据库页面', () => {
  beforeEach(() => {
    mocks.request.mockReset()
    mocks.navigate.mockReset()
    mocks.locationState = {}
  })

  it('空库引导开始研究，输入检索词后延迟更新查询状态', async () => {
    mocks.request.mockImplementation(async (path: string) =>
      path.endsWith('/runs')
        ? []
        : { items: [], total: 0, page: 1, pageSize: 20 }
    )
    const onSearchChange =
      vi.fn<(search: LibrarySearch, replace?: boolean) => void>()
    const screen = await renderLibrary({ onSearchChange })

    await expect
      .element(screen.getByText('暂无已入库的专利。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: '开始研究' }))
      .toBeInTheDocument()

    await userEvent.fill(
      screen.getByRole('textbox', { name: '检索名称或编号' }),
      '固态电池'
    )

    expect(onSearchChange).not.toHaveBeenCalled()
    await expect.poll(() => onSearchChange.mock.calls.length).toBe(1)
    expect(onSearchChange).toHaveBeenLastCalledWith({
      page: undefined,
      query: '固态电池',
    })
    expect(
      mocks.request.mock.calls.every((call) =>
        String(call[0]).startsWith('library/')
      )
    ).toBe(true)
  })

  it('显示标准表格状态、研究次数并使用标准分页更新页面', async () => {
    mocks.request.mockImplementation(async (path: string) =>
      path.endsWith('/runs')
        ? []
        : {
            items: [patent],
            total: 41,
            page: 1,
            pageSize: 20,
          }
    )
    const onSearchChange =
      vi.fn<(search: LibrarySearch, replace?: boolean) => void>()
    const screen = await renderLibrary({ onSearchChange })

    await expect.element(screen.getByText('已暂停')).toBeInTheDocument()
    await expect.element(screen.getByText('1 次研究')).toBeInTheDocument()
    await expect.element(screen.getByText('共 41 条记录')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '前往下一页' }))
    expect(onSearchChange).toHaveBeenCalledWith({
      page: 2,
      pageSize: undefined,
    })
  })

  it('按研究来源筛选并可一次重置全部筛选条件', async () => {
    const runId = 'c81705e4-0a56-4f34-a42b-10c64ac5c338'
    mocks.request.mockImplementation(async (path: string) =>
      path.endsWith('/runs')
        ? [{ runId, status: 'completed', directions: ['固态电池'] }]
        : { items: [], total: 0, page: 1, pageSize: 20 }
    )
    const onSearchChange =
      vi.fn<(search: LibrarySearch, replace?: boolean) => void>()
    const screen = await renderLibrary({ onSearchChange })

    await userEvent.click(
      screen.getByRole('combobox', { name: '按研究来源筛选' })
    )
    await userEvent.click(screen.getByRole('option', { name: /固态电池/ }))
    expect(onSearchChange).toHaveBeenCalledWith({
      page: undefined,
      runId,
    })

    await screen.rerender(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <LibraryPage
          kind='patents'
          search={{ page: 3, query: '电池', runId }}
          onSearchChange={onSearchChange}
        />
      </QueryClientProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: '重置' }))
    expect(onSearchChange).toHaveBeenLastCalledWith({
      page: undefined,
      query: undefined,
      runId: undefined,
    })
  })

  it('企业库使用企业字段列并在弹窗展示工商信息', async () => {
    const company = {
      ...patent,
      id: 'company-1',
      name: '示例科技有限公司',
      date: null,
      creditCode: '91310000TEST',
    }
    mocks.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/runs')) return []
      if (path === 'library/companies/company-1') {
        return {
          ...company,
          abstract: null,
          claims: null,
          description: null,
          cpcs: [],
          businessInfo: { 法定代表人: '张三' },
          relations: [],
        }
      }
      return { items: [company], total: 1, page: 1, pageSize: 20 }
    })
    const screen = await renderLibrary({ kind: 'companies' })

    await expect
      .element(screen.getByText('统一社会信用代码', { exact: true }))
      .toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: '示例科技有限公司' })
    )
    await expect
      .element(screen.getByRole('dialog').getByText('法定代表人'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('dialog').getByText('张三'))
      .toBeInTheDocument()
  })

  it('点击名称和行操作均在本页打开详情弹窗', async () => {
    mocks.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/runs')) return []
      if (path === 'library/patents/CNTESTA1') {
        return {
          ...patent,
          abstract: '专利摘要',
          claims: '权利要求内容',
          description: '说明书内容',
          cpcs: ['H01M'],
          businessInfo: {},
          relations: [],
        }
      }
      return { items: [patent], total: 1, page: 1, pageSize: 20 }
    })
    const screen = await renderLibrary()

    await userEvent.click(screen.getByRole('button', { name: '固态电池专利' }))
    await expect
      .element(screen.getByRole('dialog').getByText('专利摘要'))
      .toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    await userEvent.click(
      screen.getByRole('button', { name: '打开记录操作菜单' })
    )
    await userEvent.click(screen.getByRole('menuitem', { name: /查看详情/ }))
    await expect
      .element(screen.getByRole('dialog').getByText('固态电池专利'))
      .toBeInTheDocument()
  })

  it('消费跨页面 history state 并自动打开目标详情', async () => {
    mocks.locationState = {
      libraryDetail: { kind: 'patents', id: 'CNTESTA1' },
    }
    mocks.request.mockImplementation(async (path: string) => {
      if (path.endsWith('/runs')) return []
      if (path === 'library/patents/CNTESTA1') {
        return {
          ...patent,
          abstract: '由跨页入口打开',
          claims: null,
          description: null,
          cpcs: [],
          businessInfo: {},
          relations: [],
        }
      }
      return { items: [], total: 0, page: 1, pageSize: 20 }
    })
    const screen = await renderLibrary()

    await expect
      .element(screen.getByRole('dialog').getByText('由跨页入口打开'))
      .toBeInTheDocument()
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true, resetScroll: false })
    )
    const stateUpdater = mocks.navigate.mock.calls[0]?.[0].state
    expect(
      stateUpdater({ libraryDetail: mocks.locationState.libraryDetail })
        .libraryDetail
    ).toBeUndefined()
  })
})
