import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  researchCompanyDetailViewSchema,
  researchPatentPageSchema,
  researchResultViewSchema,
} from '@tech-scout/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { researchApi } from '@/lib/research-api'
import { ReportWorkspace } from './report-workspace'
import '@/styles/index.css'

afterEach(() => vi.restoreAllMocks())

it('无企业命中时仍展示全部专利评估，并可逐页展开', async () => {
  await page.viewport(1280, 800)
  const patents = Array.from({ length: 21 }, (_, index) => ({
    id: `CN${index + 1}`,
    priority: 'high' as const,
    reason: `专利 ${index + 1} 的摘要与研究问题相关`,
  }))
  vi.spyOn(researchApi, 'result').mockResolvedValue(
    researchResultViewSchema.parse({
      releaseId: 'release-v3',
      patentCount: patents.length,
      patents,
      companies: [],
      missing: ['专利权属核验'],
      emptyReason: null,
    })
  )
  const screen = await render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <div className='flex h-[800px] flex-col'>
        <ReportWorkspace runId='run' controls={null} records={null} />
      </div>
    </QueryClientProvider>
  )
  await expect.element(screen.getByText('本次没有企业查询结果')).toBeVisible()
  await expect.element(screen.getByText('CN1 · 优先')).toBeVisible()
  const directory = screen.getByRole('navigation', { name: '报告目录' })
  await expect.element(directory).toBeVisible()
  await page.screenshot({ path: '__screenshots__/report-desktop.png' })
  await page.viewport(390, 800)
  await expect.element(directory).toBeVisible()
  await page.screenshot({ path: '__screenshots__/report-mobile.png' })
  const reportPane = directory.element().parentElement!
  await screen.getByRole('button', { name: '企业', exact: true }).click()
  await expect.poll(() => reportPane.scrollTop).toBeGreaterThan(0)
  expect(screen.getByText('CN21 · 优先').all()).toHaveLength(0)
  await screen.getByRole('button', { name: '加载更多专利' }).click()
  await expect.element(screen.getByText('CN21 · 优先')).toBeVisible()
  await screen.unmount()
})

it('单栏报告通过企业弹窗切换主体，并从引用专利返回原位置', async () => {
  await page.viewport(390, 800)
  const companies = [
    {
      id: 'company-a',
      name: '甲公司',
      country: 'CN',
      priority: 'high',
      summary: '甲公司的调研分析。',
      assigneeNames: ['甲公司'],
      leadPatentCount: 1,
      citationIds: ['CN1'],
    },
    {
      id: 'company-b',
      name: '乙公司',
      country: 'CN',
      priority: 'medium',
      summary: '乙公司的调研分析。',
      assigneeNames: ['乙公司'],
      leadPatentCount: 0,
      citationIds: [],
    },
  ]
  vi.spyOn(researchApi, 'result').mockResolvedValue(
    researchResultViewSchema.parse({
      releaseId: 'release-v4',
      patentCount: 1,
      patents: [],
      companies,
      missing: [],
      emptyReason: null,
    })
  )
  vi.spyOn(researchApi, 'company').mockImplementation(async (_run, id) =>
    researchCompanyDetailViewSchema.parse({
      id,
      name: id === 'company-a' ? '甲公司' : '乙公司',
      legalName: id === 'company-a' ? '甲公司' : '乙公司',
      country: 'CN',
      businessInfo: {},
      aliases: [],
      identifiers: [],
      relations: [],
      source: { url: null, sha256: null },
    })
  )
  vi.spyOn(researchApi, 'patents').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  vi.spyOn(researchApi, 'patent').mockResolvedValue(
    researchPatentPageSchema.parse({
      items: [
        {
          id: 'CN1',
          title: '引用专利一',
          year: 2025,

          abstract: '专利摘要',
          claims: null,
          description: null,
          parties: [],
          cpcs: [],
          domains: [],
          source: { url: null, sha256: null },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <div className='flex h-[800px] flex-col'>
          <ReportWorkspace runId='run' controls={null} records={null} />
        </div>
      </QueryClientProvider>
    ),
  })
  const companiesRoute = createRoute({
    getParentRoute: () => root,
    path: '/companies',
    component: () => null,
  })
  const router = createRouter({
    routeTree: root.addChildren([companiesRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const screen = await render(<RouterProvider router={router} />)
  const firstCard = screen.getByRole('button', { name: /甲公司.*查询权利人/ })
  const directory = screen.getByRole('navigation', { name: '报告目录' })
  const reportScroll = directory.element().parentElement!
  await firstCard.click()
  const scrollBefore = reportScroll.scrollTop
  const firstDialog = screen.getByRole('dialog', { name: '甲公司' })
  await expect.element(firstDialog).toBeVisible()
  await expect.element(firstDialog).toHaveStyle({ opacity: '1' })
  await expect.element(screen.getByText('甲公司的调研分析。')).toBeVisible()
  expect((firstDialog.element() as HTMLElement).offsetHeight).toBe(800)
  await page.screenshot({ path: '__screenshots__/report-company-mobile.png' })
  await page.viewport(1280, 800)
  await expect.element(firstDialog).toHaveStyle({ opacity: '1' })
  await page.screenshot({ path: '__screenshots__/report-company-desktop.png' })
  await firstDialog.getByRole('button', { name: '下一家' }).click()
  await expect
    .element(screen.getByRole('dialog', { name: '乙公司' }))
    .toBeVisible()
  await screen.getByRole('button', { name: '上一家' }).click()
  await expect.element(firstDialog).toBeVisible()
  const citation = firstDialog.getByRole('button', { name: 'CN1' })
  await citation.click()
  const patentDialog = screen.getByRole('dialog', { name: '引用专利一' })
  await expect.element(patentDialog).toBeVisible()
  await patentDialog.getByRole('button', { name: '关闭详情' }).click()
  await expect.element(firstDialog).toBeVisible()
  await expect
    .poll(() => document.activeElement === citation.element())
    .toBe(true)
  await firstDialog.getByRole('button', { name: '下一家' }).click()
  const secondDialog = screen.getByRole('dialog', { name: '乙公司' })
  await expect.element(secondDialog).toBeVisible()
  await secondDialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect.element(firstDialog).not.toBeInTheDocument()
  await expect
    .poll(() => document.activeElement === firstCard.element())
    .toBe(true)
  expect(reportScroll.scrollTop).toBe(scrollBefore)
  await screen.unmount()
})
