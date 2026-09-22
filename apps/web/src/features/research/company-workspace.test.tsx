import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  researchSummaryViewSchema,
  type ResearchProgressView,
} from '@tech-scout/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { researchApi } from '@/lib/research-api'
import { CompanyDiscoveryRecords } from './company-discovery-records'
import { CompanyMatches } from './company-matches'
import { CompanyWorkspace } from './company-workspace'
import { SubjectResolutions } from './subject-resolutions'
import '@/styles/index.css'

const now = '2026-09-12T01:00:00Z'
const run = researchSummaryViewSchema.parse({
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  question: '企业发现',
  status: 'completed',
  sequence: 10,
  createdAt: now,
  updatedAt: now,
  ready: true,
  node: 'finish',
  error: null,
  budget: null,
  releaseId: 'release-v2',
  fromYear: 2020,
  toYear: 2026,
  domains: [],
  plan: null,
  confirmedPlan: null,
  workflowVersion: 'browser-v2',
  queriedAssigneeCount: 20,
  discoveredCompanyCount: 36,
  resolvedSubjectCount: 8,
  unresolvedSubjectCount: 12,
  hasResult: true,
  hasPatents: true,
  hasCompanies: true,
})

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } })

afterEach(() => vi.restoreAllMocks())

it('企业记录区分查询结果与执行状态，保留失败原因和来源', async () => {
  const messages = [
    '正在查询企业登记信息',
    '企业信息查询完成',
    '未找到可匹配的企业登记信息',
    '企业查询接口暂时不可用',
    '采集已停止，完成项已保留',
  ]
  const outcomes = [
    'running',
    'completed',
    'completed',
    'failed',
    'stopped',
  ] as const
  const events: ResearchProgressView[] = outcomes.map((outcome, index) => ({
    sequence: index,
    kind: 'search_progress',
    createdAt: now,
    status: 'running',
    node: 'company_snapshot',
    error: null,
    reasoning: null,
    answer: null,
    acquisition: null,
    process: {
      stage: 'companies',
      direction: `示例企业 ${index + 1}`,
      outcome,
      message: messages[index],
      ...(outcome === 'failed' ? { url: 'https://example.com/source' } : {}),
    },
  }))
  const screen = await render(
    <CompanyDiscoveryRecords events={events} active />
  )
  for (const label of ['查询中', '已完成', '未匹配', '失败', '已停止'])
    await expect.element(screen.getByText(label, { exact: true })).toBeVisible()
  await expect
    .element(screen.getByRole('link', { name: '打开查询来源 ↗' }))
    .toHaveAttribute('href', 'https://example.com/source')
  await screen.unmount()
})

it('企业候选展示独立入库结果、查询来源和供应商顺序', async () => {
  vi.spyOn(researchApi, 'companyMatches').mockResolvedValue({
    items: [
      {
        id: 'company-1',
        name: '示例科技有限公司',
        country: 'CN',
        queryNames: ['示例科技', '示例公司'],
        providerRank: 0,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  const screen = await render(
    <QueryClientProvider client={newClient()}>
      <CompanyMatches runId={run.id} />
    </QueryClientProvider>
  )
  await expect
    .element(screen.getByText('示例科技有限公司', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText(/查询命中：示例科技、示例公司 · 来源顺序 1/))
    .toBeVisible()
  await screen.unmount()
})

it('主体解析列表只读展示 Agent 映射和未解析原因', async () => {
  vi.spyOn(researchApi, 'subjectResolutions').mockResolvedValue({
    items: [
      {
        id: 'assignee-1',
        name: '示例科技',
        status: 'matched',
        confidence: 'high',
        companyId: 'company-1',
        companyName: '示例科技有限公司',
        patentCount: 4,
        candidateCount: 2,
        candidates: [
          { id: 'company-1', name: '示例科技有限公司' },
          { id: 'company-2', name: '示例技术有限公司' },
        ],
        reason: '法定名称与权利人名称一致',
      },
      {
        id: 'assignee-2',
        name: '示例研究院',
        status: 'unresolved',
        confidence: null,
        companyId: null,
        companyName: null,
        patentCount: 2,
        candidateCount: 0,
        candidates: [],
        reason: '没有企业候选',
      },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
  })
  const screen = await render(
    <QueryClientProvider client={newClient()}>
      <SubjectResolutions runId={run.id} />
    </QueryClientProvider>
  )
  await expect.element(screen.getByText('高置信推断')).toBeVisible()
  await expect
    .element(screen.getByText('未解析', { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByText('关联企业：示例科技有限公司'))
    .toBeVisible()
  await expect
    .element(screen.getByText('候选：示例科技有限公司、示例技术有限公司'))
    .toBeVisible()
  expect(
    screen.getByRole('button', { name: /确认|拒绝|提交/ }).all()
  ).toHaveLength(0)
  await screen.unmount()
})

it('企业工作台概览展示 v2 汇总统计', async () => {
  vi.spyOn(researchApi, 'companyStats').mockResolvedValue({
    total: 36,
    ranking: [],
  })
  vi.spyOn(researchApi, 'companyMatches').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  vi.spyOn(researchApi, 'subjectResolutions').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  const screen = await render(
    <QueryClientProvider client={newClient()}>
      <div className='h-[800px]'>
        <CompanyWorkspace
          run={run}
          events={[]}
          active={false}
          controls={null}
          report={null}
          recordsError={false}
          retryRecords={() => undefined}
        />
      </div>
    </QueryClientProvider>
  )
  for (const value of ['20', '36', '8', '12'])
    await expect.element(screen.getByText(value, { exact: true })).toBeVisible()
  await expect
    .element(screen.getByRole('tab', { name: '企业候选' }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('tab', { name: '主体解析' }))
    .toBeVisible()
  await screen.unmount()
})
