import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { LibraryPage } from './library-page'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiRequest: mocks.request }))
vi.mock('@/features/research/shared', () => ({
  ResearchShell: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
  ErrorNotice: () => null,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))
describe('累计数据库页面', () => {
  it('空库引导开始研究，浏览和搜索不触发采集', async () => {
    mocks.request
      .mockReset()
      .mockImplementation(async (path: string) =>
        path.endsWith('/runs')
          ? []
          : { items: [], total: 0, page: 1, pageSize: 20 }
      )
    const screen = await render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <LibraryPage kind='patents' />
      </QueryClientProvider>
    )
    await expect.element(screen.getByText('暂无匹配数据')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: '开始研究' }))
      .toBeInTheDocument()
    await screen
      .getByRole('textbox', { name: '检索名称或编号' })
      .fill('固态电池')
    await screen.getByRole('button', { name: '检索', exact: true }).click()
    await expect
      .poll(() =>
        mocks.request.mock.calls.some(
          (c) => c[2]?.searchParams?.query === '固态电池'
        )
      )
      .toBe(true)
    expect(
      mocks.request.mock.calls.every((c) => c[0].startsWith('library/'))
    ).toBe(true)
  })
  it('部分采集记录显示暂停状态和研究来源数量', async () => {
    mocks.request.mockReset().mockImplementation(async (path: string) =>
      path.endsWith('/runs')
        ? []
        : {
            items: [
              {
                id: 'CNTESTA1',
                name: '固态电池专利',
                date: '2025-01-01',
                creditCode: null,
                sources: [{ runId: crypto.randomUUID(), status: 'paused' }],
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }
    )
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <LibraryPage kind='patents' />
      </QueryClientProvider>
    )
    await expect
      .element(screen.getByRole('link', { name: '固态电池专利' }))
      .toBeInTheDocument()
    await expect.element(screen.getByText('已暂停')).toBeInTheDocument()
    await expect.element(screen.getByText('1 次研究')).toBeInTheDocument()
  })
})
