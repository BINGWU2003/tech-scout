import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  researchSummaryViewSchema,
  type ResearchProgressView,
} from '@tech-scout/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { researchApi } from '@/lib/research-api'
import { useAuthStore } from '@/stores/auth-store'
import { CompanyDiscoveryRecords } from './company-discovery-records'
import { CompanyMatches } from './company-matches'
import { companyRecords, loadReviewDraft } from './company-review-data'
import { CompanyWorkspace } from './company-workspace'
import { CandidateEditor, EntityReview } from './entity-review'
import '@/styles/index.css'
const now = '2026-09-12T01:00:00Z'
const userId = crypto.randomUUID()
const run = researchSummaryViewSchema.parse({
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  question: '企业核验',
  status: 'awaiting_entities',
  sequence: 10,
  createdAt: now,
  updatedAt: now,
  ready: true,
  node: 'entity',
  error: null,
  budget: null,
  releaseId: null,
  fromYear: 2020,
  toYear: 2026,
  domains: [],
  plan: null,
  confirmedPlan: null,
  pendingCandidateIds: ['a', 'b'],
  candidateCount: 2,
  hasResult: false,
  hasCompanies: true,
})
const key = `research-review-v1:${userId}:${run.id}`

it('企业记录区分查询结果与执行状态，保留失败原因和来源', async () => {
  await page.viewport(1280, 900)
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
  const ui = (active: boolean) => (
    <div className='h-[820px] w-[560px] overflow-y-auto p-4'>
      <CompanyDiscoveryRecords events={events} active={active} />
    </div>
  )
  const screen = await render(ui(true))
  for (const label of ['查询中', '已完成', '未匹配', '失败', '已停止'])
    await expect.element(screen.getByText(label, { exact: true })).toBeVisible()
  await expect
    .element(screen.getByText(messages[3], { exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('link', { name: '打开查询来源 ↗' }))
    .toHaveAttribute('href', 'https://example.com/source')
  expect(screen.getByRole('listitem').all()).toHaveLength(5)
  await page.screenshot({
    path: '__screenshots__/company-discovery-records.png',
  })
  await screen.rerender(ui(false))
  await expect
    .element(screen.getByText('已停止', { exact: true }).first())
    .toBeVisible()
  expect(screen.getByText('已停止', { exact: true }).all()).toHaveLength(2)
  await screen.unmount()
})

const candidate = (id: string) => ({
  id,
  name: id === 'a' ? '甲科技候选主体' : '乙科技候选主体',
  country: null,
  countryStatus: 'unknown' as const,
  countrySource: null,
  status: 'unverified',
  needsReview: true,
  terminalExclusion: false,
  decision: null,
  patentCount: 3,
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.removeItem(key)
  useAuthStore.getState().auth.reset()
})

it.each(['matched', 'review'] as const)(
  '%s 列表触底追加，失败保留条目，重试后结束加载',
  async (kind) => {
    await page.viewport(390, 844)
    const records = Array.from({ length: 21 }, (_, index) => ({
      ...candidate(`company-${index}`),
      name: `示例企业 ${index + 1}`,
    }))
    let failNextPage = true
    const response = async (_run: string, number: number) => {
      if (number === 2 && failNextPage) {
        failNextPage = false
        throw new Error('offline')
      }
      return {
        items: records.slice((number - 1) * 20, number * 20),
        total: records.length,
        page: number,
        pageSize: 20,
      }
    }
    const matches = vi
      .spyOn(researchApi, 'companyMatches')
      .mockImplementation(response)
    const candidates = vi
      .spyOn(researchApi, 'candidates')
      .mockImplementation(response)
    const request = kind === 'matched' ? matches : candidates
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const screen = await render(
      <QueryClientProvider client={client}>
        <div data-testid='company-scroll' className='h-[400px] overflow-y-auto'>
          {kind === 'matched' ? (
            <CompanyMatches runId={run.id} />
          ) : (
            <EntityReview
              run={run}
              busy={false}
              onSubmit={async () => {}}
              renderWorkspace={({ list }) => list}
            />
          )}
        </div>
      </QueryClientProvider>
    )
    await expect
      .element(screen.getByText(records[0].name, { exact: true }))
      .toBeVisible()
    expect(request).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('listitem').all()).toHaveLength(20)
    expect(
      screen.getByRole('button', { name: /上一页|下一页|加载更多/ }).all()
    ).toHaveLength(0)
    const panel = screen.getByTestId('company-scroll').element() as HTMLElement
    panel.scrollTop = panel.scrollHeight
    await expect
      .element(screen.getByText('加载失败，已保留现有列表。'))
      .toBeVisible()
    expect(request).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('listitem').all()).toHaveLength(20)
    const previousScroll = panel.scrollTop
    await screen.getByRole('button', { name: '重试加载' }).click()
    await expect.poll(() => screen.getByRole('listitem').all().length).toBe(21)
    expect(panel.scrollTop).toBe(previousScroll)
    panel.scrollTop = panel.scrollHeight
    await expect.element(screen.getByText('已全部加载')).toBeVisible()
    await expect.element(screen.getByText('已加载 21 / 21 项')).toBeVisible()
    expect(request).toHaveBeenCalledTimes(3)
    expect(request.mock.calls.map((call) => call[1])).toEqual([1, 2, 2])
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    await page.screenshot({
      path: `__screenshots__/company-${kind}-infinite-mobile.png`,
    })
    await screen.unmount()
    client.clear()
  }
)

it('草稿恢复、连续核验、失败保留与成功清理，手机切换到依据面板', async () => {
  await page.viewport(1280, 900)
  useAuthStore.getState().auth.setSession({
    user: {
      id: userId,
      username: 'reviewer',
      email: 'reviewer@example.com',
      role: 'user',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
    csrfToken: 'x'.repeat(32),
  })
  vi.spyOn(researchApi, 'companyStats').mockResolvedValue({
    total: 30,
    ranking: [{ id: 'c', name: '示例新能源科技有限公司', patentCount: 36 }],
  })
  vi.spyOn(researchApi, 'companyMatches').mockResolvedValue({
    items: [
      {
        id: 'c',
        name: '示例新能源科技有限公司',
        country: 'CN',
        patentCount: 36,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.spyOn(researchApi, 'candidates').mockResolvedValue({
    items: [candidate('a'), candidate('b')],
    total: 2,
    page: 1,
    pageSize: 20,
  })
  vi.spyOn(researchApi, 'candidate').mockImplementation(async (_run, id) => ({
    ...candidate(id),
    evidence: [],
    reviewNote: null,
    companyOptions: [],
  }))
  const submit = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(undefined)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const ui = () => (
    <QueryClientProvider client={client}>
      <div className='flex h-[820px] flex-col p-4'>
        <CompanyWorkspace
          run={run}
          events={[]}
          active={false}
          busy={false}
          readOnly={false}
          onSubmit={submit}
          controls={null}
          report={null}
          recordsError={false}
          retryRecords={() => {}}
        />
      </div>
    </QueryClientProvider>
  )
  let screen = await render(ui())
  await expect
    .element(screen.getByRole('tab', { name: '待核验主体' }))
    .toHaveAttribute('aria-selected', 'true')
  const submitButton = screen.getByRole('button', {
    name: '确认主体并生成报告',
  })
  expect(
    submitButton.element().closest('section')?.getAttribute('aria-label')
  ).toBe('企业概览与核验')
  await screen.getByRole('tab', { name: '概览', exact: true }).click()
  await expect
    .element(screen.getByText('已暂存决定', { exact: true }))
    .toBeVisible()
  await expect
    .element(
      screen
        .getByRole('button', { name: /查看并处理/, includeHidden: true })
        .first()
    )
    .not.toBeVisible()
  await expect.element(submitButton).toBeVisible()
  await screen.getByRole('tab', { name: '已匹配企业', exact: true }).click()
  await expect
    .element(
      screen.getByRole('button', { name: '查看依据：示例新能源科技有限公司' })
    )
    .toBeVisible()
  await expect
    .element(screen.getByText('已暂存决定', { exact: true }))
    .not.toBeVisible()
  await page.screenshot({ path: '__screenshots__/company-matches-desktop.png' })
  await screen.getByRole('tab', { name: '待核验主体' }).click()
  await screen
    .getByRole('button', { name: /查看并处理/ })
    .first()
    .click()
  await expect
    .element(screen.getByRole('button', { name: '查看并处理：甲科技候选主体' }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect
    .element(screen.getByRole('heading', { name: '甲科技候选主体' }))
    .toBeVisible()
  const choose = () =>
    screen
      .getByRole('combobox', { name: '本次决定' })
      .element() as HTMLSelectElement
  choose().value = 'skip'
  choose().dispatchEvent(new Event('change', { bubbles: true }))
  await screen.getByRole('button', { name: '暂存并继续核验' }).click()
  await expect
    .element(screen.getByRole('heading', { name: '乙科技候选主体' }))
    .toBeVisible()
  expect(loadReviewDraft(key, ['a', 'b'])).toHaveProperty('a.action', 'skip')
  await page.screenshot({ path: '__screenshots__/company-review-detail.png' })
  await screen.unmount()
  screen = await render(ui())
  await expect
    .element(screen.getByText('已暂存：本次跳过', { exact: false }))
    .toBeVisible()
  await page.viewport(390, 844)
  await screen
    .getByRole('button', { name: /查看并处理/ })
    .last()
    .click()
  await expect
    .element(screen.getByRole('heading', { name: '乙科技候选主体' }))
    .toBeVisible()
  choose().value = 'reject'
  choose().dispatchEvent(new Event('change', { bubbles: true }))
  await screen.getByRole('button', { name: '暂存并继续核验' }).click()
  await screen.getByRole('button', { name: '确认主体并生成报告' }).click()
  await expect
    .element(screen.getByText('提交失败，草稿已保留，请重试。'))
    .toBeVisible()
  expect(Object.keys(loadReviewDraft(key, ['a', 'b']))).toHaveLength(2)
  await page.screenshot({ path: '__screenshots__/company-review-mobile.png' })
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await screen.getByRole('button', { name: '确认主体并生成报告' }).click()
  await expect.poll(() => localStorage.getItem(key)).toBeNull()
  expect(submit.mock.calls[1][0].decisions).toHaveLength(2)
  await page.viewport(1280, 900)
  await page.screenshot({ path: '__screenshots__/company-review-desktop.png' })
  await screen.unmount()
  client.clear()
})
it('查询进度不刷屏，同名主体更新完成状态，不合并不同企业', () => {
  const events = Array.from({ length: 100 }, (_, i): ResearchProgressView => ({
    sequence: i,
    kind: 'acquisition_progress',
    createdAt: now,
    status: 'running',
    node: 'company_snapshot',
    error: null,
    reasoning: null,
    answer: null,
    acquisition: {
      stage: 'companies',
      status: 'running',
      completed: i,
      total: 100,
    },
  }))
  const process = {
    stage: 'companies',
    direction: '甲公司',
    message: '查询中',
    outcome: 'running' as const,
  }
  events.push(
    {
      ...events[0],
      acquisition: null,
      sequence: 101,
      kind: 'search_progress',
      process,
    },
    {
      ...events[0],
      acquisition: null,
      sequence: 102,
      kind: 'search_progress',
      process: { ...process, outcome: 'completed', message: '查询完成' },
    },
    {
      ...events[0],
      acquisition: null,
      sequence: 103,
      kind: 'search_progress',
      process: { ...process, direction: '乙公司' },
    }
  )
  expect(companyRecords(events)).toHaveLength(2)
  expect(companyRecords(events)[0].process?.outcome).toBe('completed')
})
it('确认匹配必须选择支持证据，禁止确认的主体不能通过已有草稿确认', async () => {
  const save = vi.fn()
  const detail = {
    ...candidate('a'),
    evidence: [],
    reviewNote: null,
    companyOptions: [
      { id: 'c', name: '公司', country: 'CN', supportingEvidenceIds: [] },
    ],
  }
  const screen = await render(
    <CandidateEditor
      detail={detail}
      editable
      save={save}
      initial={{
        candidate_id: 'a',
        action: 'confirm',
        company_id: 'c',
        evidence_ids: [],
        note: '',
      }}
    />
  )
  await expect
    .element(screen.getByRole('button', { name: '暂存并继续核验' }))
    .toBeDisabled()
  await screen.unmount()
  localStorage.setItem(
    key,
    JSON.stringify([
      {
        candidate_id: 'a',
        action: 'confirm',
        company_id: null,
        evidence_ids: [],
        note: '',
      },
    ])
  )
  expect(loadReviewDraft(key, ['a'])).toEqual({})
  expect(loadReviewDraft(key, ['other'])).toEqual({})
})

it('仅支持所选公司的证据可确认，历史只读不显示操作', async () => {
  const save = vi.fn()
  const evidence = {
    id: 'e1',
    publisher: '企业登记信息',
    observedAt: now,
    legalName: '甲公司',
    country: 'CN',
    identifierType: 'registration',
    identifierValue: '123',
    preserved: true,
    contentHash: null,
    source: { sha256: null },
  }
  const detail = {
    ...candidate('a'),
    evidence: [evidence],
    reviewNote: null,
    companyOptions: [
      { id: 'c', name: '甲公司', country: 'CN', supportingEvidenceIds: ['e1'] },
    ],
  }
  const initial = {
    candidate_id: 'a',
    action: 'confirm' as const,
    company_id: 'c',
    evidence_ids: [],
    note: '',
  }
  const screen = await render(
    <CandidateEditor detail={detail} editable save={save} initial={initial} />
  )
  await screen.getByRole('checkbox', { name: '选择证据 e1' }).click()
  await screen.getByRole('button', { name: '暂存并继续核验' }).click()
  expect(save).toHaveBeenCalledWith({ ...initial, evidence_ids: ['e1'] })
  await screen.rerender(
    <CandidateEditor
      detail={{ ...detail, terminalExclusion: true }}
      editable
      save={save}
      initial={initial}
    />
  )
  await expect
    .element(screen.getByRole('button', { name: '暂存并继续核验' }))
    .toBeDisabled()
  await screen.rerender(
    <CandidateEditor detail={detail} editable={false} save={save} />
  )
  await expect
    .element(screen.getByRole('combobox', { name: '本次决定' }))
    .not.toBeInTheDocument()
  await screen.unmount()
})
