import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  researchSummaryViewSchema,
  type ResearchProgressView,
} from '@tech-scout/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { researchApi } from '@/lib/research-api'
import { patentSearchData } from './patent-search-data'
import { PatentWorkspace } from './patent-workspace'
import '@/styles/index.css'

afterEach(() => vi.restoreAllMocks())
const now = '2026-09-12T01:00:00Z'
const run = researchSummaryViewSchema.parse({
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  question: '固态电池研究',
  status: 'running',
  sequence: 200,
  createdAt: now,
  updatedAt: now,
  ready: true,
  node: 'snapshot',
  error: null,
  budget: null,
  releaseId: null,
  fromYear: 2020,
  toYear: 2026,
  domains: [],
  plan: null,
  confirmedPlan: {
    from_year: 2020,
    to_year: 2026,
    risks: [],
    directions: [
      {
        domain_id: 'battery',
        name: '固态电解质',
        explanation: '离子传导材料',
        keywords: ['solid electrolyte'],
        excluded_keywords: [],
        cpc_prefixes: ['H01M'],
      },
    ],
  },
  hasResult: false,
})
const event = (
  sequence: number,
  overrides: Partial<ResearchProgressView>
): ResearchProgressView => ({
  sequence,
  kind: 'search_progress',
  createdAt: now,
  status: 'running',
  node: 'snapshot',
  error: null,
  reasoning: null,
  answer: null,
  ...overrides,
})
const search = {
  stage: 'search',
  direction: '固态电解质',
  keyword: 'solid electrolyte',
  page: 1,
  url: 'https://patents.google.com/?q=solid',
  message: '检索',
  outcome: 'running' as const,
}
const events = [
  event(1, { process: search }),
  event(2, {
    process: { ...search, outcome: 'completed', count: 200, completed: 150 },
  }),
  ...Array.from({ length: 120 }, (_, i) =>
    event(i + 3, {
      kind: 'acquisition_progress',
      acquisition: {
        stage: 'patents',
        status: 'running',
        completed: i + 1,
        total: 150,
      },
    })
  ),
]

it('同页重试保留异常且不重复累计，搜索上限不冒充结果总量，旧状态不覆盖新详情', () => {
  const failed = event(2, {
    process: { ...search, outcome: 'failed', message: '来源暂不可用' },
  })
  const data = patentSearchData(
    {
      ...run,
      acquisition: {
        stage: 'search',
        status: 'running',
        completed: 5,
        total: 1000,
      },
    },
    [
      events[0],
      failed,
      event(3, {
        process: { ...search, outcome: 'completed', count: 20, completed: 5 },
      }),
    ]
  )
  expect(data.groups).toHaveLength(1)
  expect(data.groups[0].pages.size).toBe(1)
  expect(data.completedPages).toBe(1)
  expect(data.discovered).toBe(5)
  expect(data.details).toBeNull()
  expect(data.notices[0].process?.message).toBe('来源暂不可用')
  const newer = patentSearchData(
    {
      ...run,
      sequence: 1,
      acquisition: {
        stage: 'patents',
        status: 'running',
        completed: 1,
        total: 150,
      },
    },
    events
  )
  expect(newer.details?.completed).toBe(120)
})

it('120 次详情更新只显示一张进度卡，双栏可调整，手机切换不溢出', async () => {
  await page.viewport(1280, 900)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const screen = await render(
    <QueryClientProvider client={client}>
      <div className='flex h-[800px] flex-col p-4'>
        <PatentWorkspace
          run={run}
          events={events}
          active
          eventsError={false}
          onRetryEvents={() => {}}
          controls={<button>暂停本次研究</button>}
          actions={null}
        />
      </div>
    </QueryClientProvider>
  )
  await expect
    .element(screen.getByText('已获取 120 / 150 篇专利详情'))
    .toBeVisible()
  expect(
    screen.getByRole('region', { name: '专利详情获取进度' }).all()
  ).toHaveLength(1)
  expect(
    screen.getByRole('link', { name: '打开检索来源 ↗' }).all()
  ).toHaveLength(1)
  await expect
    .element(screen.getByText('第 1 页 · 返回 200 条结果'))
    .toBeVisible()
  const left = screen
    .getByRole('region', { name: '专利概览', exact: true })
    .element()
    .getBoundingClientRect()
  const right = screen
    .getByRole('region', { name: '专利搜索记录', exact: true })
    .element()
    .getBoundingClientRect()
  expect(left.right).toBeLessThan(right.left)
  await screen.getByRole('separator').click()
  await page.screenshot({ path: '__screenshots__/patent-search-desktop.png' })
  await page.viewport(390, 844)
  await expect
    .element(screen.getByRole('button', { name: '专利概览', exact: true }))
    .toBeVisible()
  await screen.getByRole('button', { name: '搜索记录', exact: true }).click()
  await expect
    .element(screen.getByRole('button', { name: '暂停本次研究' }))
    .toBeVisible()
  await page.screenshot({ path: '__screenshots__/patent-search-mobile.png' })
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await screen.getByRole('button', { name: '专利概览', exact: true }).click()
  await expect
    .element(screen.getByText('去重专利', { exact: true }))
    .toBeVisible()
  await screen.unmount()
  client.clear()
  await page.viewport(1280, 900)
})

it.each([1280, 390])(
  '宽度 %i 时回看记录显示回到底部按钮，更新不打断滚动，点击返回最新进度',
  async (width) => {
    await page.viewport(width, 844)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const history = [
      event(1, {
        process: {
          stage: 'search',
          outcome: 'completed',
          message: '普通阶段摘要',
        },
      }),
      event(2, {
        process: { ...search, outcome: 'failed', message: '历史检索失败' },
      }),
      ...Array.from({ length: 20 }, (_, index) =>
        event(index + 3, {
          process: {
            ...search,
            page: index + 1,
            outcome: 'completed',
            count: 10,
          },
        })
      ),
      ...events.filter((item) => item.acquisition),
    ]
    const ui = (currentEvents: ResearchProgressView[]) => (
      <QueryClientProvider client={client}>
        <div className='flex h-[780px] flex-col p-4'>
          <PatentWorkspace
            run={run}
            events={currentEvents}
            active
            eventsError={false}
            onRetryEvents={() => {}}
            controls={null}
            actions={null}
          />
        </div>
      </QueryClientProvider>
    )
    const screen = await render(ui(history))
    if (width === 390)
      await screen
        .getByRole('button', { name: '搜索记录', exact: true })
        .click()
    const card = screen.getByRole('region', {
      name: '专利详情获取进度',
      includeHidden: true,
    })
    await expect.element(card).toBeVisible()
    const viewport = card.element().parentElement!.parentElement!
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    const backToBottom = screen.getByRole('button', { name: '回到底部' })
    expect(backToBottom.all()).toHaveLength(0)
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight - 100
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(backToBottom.all()).toHaveLength(0)
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    await expect.poll(() => viewport.scrollTop).toBe(0)
    await expect.element(backToBottom).toBeVisible()
    expect(card.element().getBoundingClientRect().top).toBeGreaterThan(
      viewport.getBoundingClientRect().bottom
    )
    await expect
      .element(screen.getByText('第 1 页 · 返回 10 条结果'))
      .toBeVisible()
    expect(screen.getByText('普通阶段摘要').all()).toHaveLength(0)
    expect(screen.getByText('阶段摘要与异常').all()).toHaveLength(0)
    expect(
      screen.getByRole('region', { name: '专利详情获取进度' }).all()
    ).toHaveLength(1)
    await screen.rerender(
      ui([
        ...history,
        event(250, {
          kind: 'acquisition_progress',
          acquisition: {
            stage: 'patents',
            status: 'running',
            completed: 130,
            total: 150,
          },
        }),
      ])
    )
    await expect
      .element(screen.getByText('已获取 130 / 150 篇专利详情'))
      .toBeInTheDocument()
    expect(viewport.scrollTop).toBe(0)
    await expect.element(backToBottom).toBeVisible()
    await page.screenshot({
      path: `__screenshots__/patent-scroll-to-bottom-${width}.png`,
    })
    await backToBottom.click()
    await expect
      .poll(
        () => viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      )
      .toBeLessThanOrEqual(1)
    await expect.poll(() => backToBottom.all().length).toBe(0)
    await expect
      .element(screen.getByText('已获取 130 / 150 篇专利详情'))
      .toBeVisible()
    await expect.element(screen.getByText('历史检索失败')).toBeVisible()
    await expect
      .element(screen.getByText('第 20 页 · 返回 10 条结果'))
      .toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    if (width === 390) {
      await screen
        .getByRole('button', { name: '专利概览', exact: true })
        .click()
    }
    await expect
      .poll(() => card.element().getClientRects().length > 0)
      .toBe(width !== 390)
    await screen.unmount()
    client.clear()
  }
)

it('完成后统计使用全量结果，保留列表和详情，并允许统计失败后重试', async () => {
  await page.viewport(1280, 900)
  const stats = vi
    .spyOn(researchApi, 'patentStats')
    .mockRejectedValueOnce(new Error('暂不可用'))
    .mockResolvedValue({
      total: 63,
      years: [
        { year: 2024, dateKind: 'publication', count: 40 },
        { year: 2025, dateKind: 'publication', count: 23 },
      ],
      unknownYearCount: 0,
      classifications: [
        { code: 'H01M', count: 51 },
        { code: 'C01B', count: 24 },
      ],
      unclassifiedCount: 2,
    })
  const patent = {
    id: 'CN123A',
    title: '固态电解质材料及其制备方法',
    year: 2025,
    dateKind: 'publication' as const,
    cpcs: ['H01M'],
    domains: ['battery'],
    parties: [],
    source: { sha256: null },
  }
  const list = vi
    .spyOn(researchApi, 'patents')
    .mockImplementation(async (_id, page) => ({
      items: Array.from(
        { length: Math.min(20, 63 - (page - 1) * 20) },
        (_, index) => ({
          ...patent,
          id: `CN${(page - 1) * 20 + index + 1}A`,
          title: `${patent.title} ${(page - 1) * 20 + index + 1}`,
        })
      ),
      page,
      pageSize: 20,
      total: 63,
    }))
  vi.spyOn(researchApi, 'patent').mockResolvedValue({
    items: [patent],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const screen = await render(
    <QueryClientProvider client={client}>
      <div className='flex h-[820px] flex-col p-4'>
        <PatentWorkspace
          run={{ ...run, hasPatents: true, status: 'awaiting_companies' }}
          events={events}
          active={false}
          eventsError={false}
          onRetryEvents={() => {}}
          controls={null}
          actions={<button>开始企业发现</button>}
        />
      </div>
    </QueryClientProvider>
  )
  await screen.getByRole('button', { name: '重新加载统计' }).click()
  await expect.element(screen.getByText('63', { exact: true })).toBeVisible()
  expect(stats).toHaveBeenCalledTimes(2)
  await expect
    .element(screen.getByText('已获取 63 / 63 篇专利详情'))
    .toBeVisible()
  await expect
    .element(screen.getByRole('heading', { name: '技术分类分布' }))
    .toBeVisible()
  await page.screenshot({ path: '__screenshots__/patent-search-results.png' })
  await screen
    .getByRole('button', { name: `${patent.title} 1`, exact: true })
    .click()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  const patentList = screen
    .getByRole('list', { name: '本次专利列表' })
    .element()
  const scrollPanel = patentList.closest('section')!.parentElement!
  scrollPanel.scrollTop = scrollPanel.scrollHeight
  await expect
    .element(
      screen.getByRole('button', { name: `${patent.title} 21`, exact: true })
    )
    .toBeInTheDocument()
  expect(list).toHaveBeenLastCalledWith(run.id, 2, undefined)
  await screen.unmount()
  client.clear()
})
