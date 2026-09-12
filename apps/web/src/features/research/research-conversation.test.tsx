import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  researchSummaryViewSchema,
  type ResearchWorkspace,
} from '@tech-scout/contracts'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { DirectionProvider } from '@/context/direction-provider'
import { FontProvider } from '@/context/font-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { researchApi } from '@/lib/research-api'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/stores/auth-store'
import { ResearchComposer } from './research-composer'
import { ResearchTimeline } from './research-timeline'
import '@/styles/index.css'

afterEach(() => {
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('执行中可编辑但不能发送；中文输入法回车不误发送', async () => {
  const submit = vi.fn()
  function Composer({ blocked }: { blocked: boolean }) {
    const [value, setValue] = useState('')
    return (
      <ResearchComposer
        value={value}
        onChange={setValue}
        onSubmit={submit}
        busy={false}
        blocked={blocked}
      />
    )
  }
  const screen = await render(<Composer blocked />)
  const input = screen.getByRole('textbox', { name: '研究需求' })
  await input.fill('只看近五年')
  await expect
    .element(screen.getByRole('button', { name: '发送研究需求' }))
    .toBeDisabled()
  input
    .element()
    .dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    )
  expect(submit).not.toHaveBeenCalled()
  await screen.rerender(<Composer blocked={false} />)
  input.element().dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
    })
  )
  expect(submit).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: '发送研究需求' }).click()
  expect(submit).toHaveBeenCalledOnce()
})

it('完成后折叠过程，展开仍能回看超过 100 条的最早检索记录', async () => {
  const events = Array.from({ length: 120 }, (_, i) => ({
    sequence: i + 1,
    kind: 'search_progress',
    reasoning: null,
    answer: null,
    createdAt: '2026-09-10T01:00:00Z',
    status: 'running' as const,
    node: 'snapshot',
    error: null,
    process: {
      stage: 'search',
      message: `第 ${i + 1} 条检索记录`,
      outcome: 'completed' as const,
      keyword: '固态电池',
      url: 'https://patents.google.com/?q=battery',
      page: i + 1,
      count: 2,
      completed: 2,
    },
  }))
  const screen = await render(<ResearchTimeline events={events} active />)
  await expect
    .element(screen.getByText('第 1 条检索记录', { exact: true }))
    .toBeVisible()
  await screen.rerender(<ResearchTimeline events={events} active={false} />)
  await expect
    .element(screen.getByRole('button', { name: /研究过程与依据/ }))
    .toHaveAttribute('aria-expanded', 'false')
  await screen.getByRole('button', { name: /研究过程与依据/ }).click()
  await expect
    .element(screen.getByText('第 1 条检索记录', { exact: true }))
    .toBeVisible()
  expect(
    screen.getByRole('link', { name: '打开检索来源 ↗' }).all()
  ).toHaveLength(120)
})

it('工作台从左侧切换项目，确认前追问保留上下文，并在手机上保持输入框可见', async () => {
  await page.viewport(1280, 900)
  const now = '2026-09-10T01:00:00.000Z'
  const projectId = crypto.randomUUID(),
    firstId = crypto.randomUUID(),
    secondId = crypto.randomUUID()
  useAuthStore.getState().auth.setSession({
    csrfToken: 'x'.repeat(32),
    user: {
      id: crypto.randomUUID(),
      username: 'researcher',
      email: 'researcher@example.com',
      role: 'user',
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    },
  })
  const plan = {
    from_year: 2021,
    to_year: 2026,
    risks: [],
    directions: [
      {
        domain_id: 'battery',
        name: '固态电解质',
        keywords: ['固态电解质'],
        excluded_keywords: [],
        cpc_prefixes: [],
        explanation: '围绕离子传导材料展开检索。',
      },
    ],
  }
  const project = {
    id: projectId,
    title: '固态电池技术研究',
    question: '固态电池技术研究',
    createdAt: now,
    runs: [
      {
        id: firstId,
        question: '固态电池技术研究',
        status: 'awaiting_plan' as const,
        sequence: 3,
        createdAt: now,
      },
    ],
  }
  const summary = (id: string) =>
    researchSummaryViewSchema.parse({
      id,
      projectId,
      question: id === firstId ? project.question : '只看近五年',
      status: 'awaiting_plan',
      sequence: 3,
      createdAt: now,
      updatedAt: now,
      ready: true,
      node: 'plan_gate',
      error: null,
      budget: null,
      releaseId: null,
      fromYear: 1800,
      toYear: 2026,
      domains: [],
      plan,
      confirmedPlan: null,
      pendingCandidateIds: [],
      candidateCount: 0,
      hasResult: false,
    })
  const workspace: ResearchWorkspace = {
    revision: 0,
    selectedPlan: plan,
    candidates: plan,
    messages: [],
    latestResultRunId: null,
    resultOutdated: false,
    activeRunId: firstId,
    executionRunId: null,
    blocked: false,
  }
  vi.spyOn(researchApi, 'workspace').mockImplementation(async () => ({
    ...workspace,
    messages: project.runs.flatMap((run) => [
      {
        id: run.id,
        runId: run.id,
        role: 'user' as const,
        reasoning: null,
        answer: null,
        pending: false,
        text: run.question,
        createdAt: now,
        plan: null,
        proposal: false,
        applied: false,
        outdated: false,
        hasResult: false,
      },
      {
        id: `${run.id}-reply`,
        runId: run.id,
        role: 'assistant' as const,
        answer: null,
        reasoning: {
          id: run.id,
          status: 'completed' as const,
          text: '结合研究范围，比较材料体系与离子传导机制。',
          startedAt: now,
          durationMs: 3200,
          truncated: false,
        },
        pending: false,
        text: '建议先从固态电解质入手，关注离子传导材料与界面稳定性。',
        createdAt: now,
        plan,
        recommendation: true,
        proposal: false,
        applied: false,
        outdated: false,
        hasResult: false,
      },
    ]),
  }))
  const workspaceAction = vi
    .spyOn(researchApi, 'workspaceAction')
    .mockImplementation(async (_id, input) => {
      if (input.kind === 'save_plan') {
        workspace.selectedPlan = input.plan
        workspace.revision += 1
      }
      if (input.kind === 'start_search') {
        advanced = true
        workspace.activeRunId = secondId
        workspace.executionRunId = secondId
      }
      return structuredClone(workspace)
    })
  vi.spyOn(researchApi, 'projects').mockImplementation(async () => [project])
  vi.spyOn(researchApi, 'project').mockImplementation(async () =>
    structuredClone(project)
  )
  vi.spyOn(researchApi, 'summary').mockImplementation(async (id) =>
    advanced && id === secondId
      ? {
          ...summary(id),
          status: 'awaiting_companies',
          node: 'company_gate',
          confirmedPlan: plan,
          hasPatents: true,
        }
      : summary(id)
  )
  vi.spyOn(researchApi, 'events').mockResolvedValue([
    {
      sequence: 1,
      kind: 'planner_progress',
      reasoning: null,
      answer: null,
      createdAt: now,
      status: 'running',
      node: 'planner',
      error: null,
      process: {
        stage: 'planner',
        message: '正在生成技术方向与关键词',
        outcome: 'running',
      },
    },
  ])
  let advanced = false
  vi.spyOn(researchApi, 'patents').mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    pageSize: 20,
  })
  const action = vi
    .spyOn(researchApi, 'action')
    .mockImplementation(async (id) => {
      advanced = true
      return {
        ...summary(id),
        status: 'awaiting_companies',
        node: 'company_gate',
        confirmedPlan: plan,
        hasPatents: true,
      }
    })
  const followup = vi
    .spyOn(researchApi, 'newRun')
    .mockImplementation(async () => {
      project.runs.push({
        id: secondId,
        question: '只看近五年',
        status: 'awaiting_plan',
        sequence: 3,
        createdAt: now,
      })
      return summary(secondId)
    })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/research'] }),
  })
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme='light'>
        <FontProvider>
          <DirectionProvider>
            <RouterProvider router={router} />
          </DirectionProvider>
        </FontProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
  await expect
    .element(screen.getByRole('heading', { name: '今天想探索什么技术？' }))
    .toBeVisible()
  await screen
    .getByRole('link', { name: '固态电池技术研究', exact: true })
    .click()
  await expect
    .element(screen.getByRole('button', { name: '开始研究' }))
    .toBeVisible()
  expect(action).not.toHaveBeenCalled()
  const reply = screen.getByText(
    '建议先从固态电解质入手，关注离子传导材料与界面稳定性。'
  )
  await expect.element(reply).toBeVisible()
  const recommendation = screen.getByText('AI 推荐方向', { exact: true })
  expect(reply.element().getBoundingClientRect().bottom).toBeLessThan(
    recommendation.element().getBoundingClientRect().top
  )
  await expect
    .element(screen.getByRole('button', { name: /思考已完成/ }))
    .toHaveAttribute('aria-expanded', 'false')
  await expect
    .element(screen.getByRole('button', { name: '刷新状态' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: '取消本次研究' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: /研究过程与依据/ }))
    .not.toBeInTheDocument()
  await page.screenshot({ path: '__screenshots__/research-desktop.png' })
  await screen.getByRole('textbox', { name: '方向描述' }).fill('修改后的范围')
  await screen.getByRole('button', { name: '深度思考' }).click()
  await screen.getByRole('textbox', { name: '继续研究' }).fill('只看近五年')
  await screen.getByRole('button', { name: '发送研究需求' }).click()
  await expect.poll(() => followup.mock.calls.length).toBe(1)
  expect(followup.mock.calls[0]).toEqual([
    projectId,
    expect.objectContaining({
      question: '只看近五年',
      parentRunId: firstId,
      thinking: false,
    }),
  ])
  await expect
    .element(screen.getByRole('combobox', { name: '研究轮次' }))
    .not.toBeInTheDocument()
  expect(workspaceAction).toHaveBeenCalledWith(
    projectId,
    expect.objectContaining({
      kind: 'save_plan',
      revision: 0,
      plan: expect.objectContaining({
        directions: [expect.objectContaining({ explanation: '修改后的范围' })],
      }),
    })
  )
  expect(router.state.location.pathname).toBe(`/research/${projectId}/plan`)
  await page.viewport(390, 844)
  await expect
    .element(screen.getByRole('textbox', { name: '继续研究' }))
    .toBeVisible()
  const rect = screen
    .getByRole('textbox', { name: '继续研究' })
    .element()
    .getBoundingClientRect()
  expect(rect.bottom).toBeLessThanOrEqual(844)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '__screenshots__/research-mobile.png' })
  await page.viewport(1280, 900)
  await screen.getByRole('textbox', { name: '方向描述' }).fill('最终检索范围')
  await screen.getByRole('button', { name: '保存并开始研究' }).click()
  await expect
    .element(screen.getByRole('heading', { name: '专利检索', exact: true }))
    .toBeVisible()
  expect(workspaceAction).toHaveBeenLastCalledWith(
    projectId,
    expect.objectContaining({ kind: 'start_search', revision: 2 })
  )
  expect(router.state.location.pathname).toBe(`/research/${projectId}/patents`)
  await expect
    .element(screen.getByRole('button', { name: '开始企业发现 →' }))
    .toBeVisible()
  expect(workspaceAction).toHaveBeenCalledTimes(3)
  await expect
    .element(screen.getByRole('textbox', { name: '继续研究' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('heading', { name: '本次研究结果' }))
    .not.toBeInTheDocument()
  await page.screenshot({ path: '__screenshots__/research-patents.png' })
  await screen.getByRole('link', { name: '3. 企业发现与核验' }).click()
  expect(workspaceAction).toHaveBeenCalledTimes(3)
  await expect
    .element(screen.getByText('请先在专利检索页点击“开始企业发现”。'))
    .toBeVisible()
  await screen.getByRole('link', { name: '1. 技术方向与计划' }).click()
  await expect
    .element(screen.getByRole('button', { name: '开始研究' }))
    .toBeVisible()
  // A fresh route mount uses the address, without resetting to the current execution stage.
  await router.navigate({
    to: '/research/$projectId/$stage',
    params: { projectId, stage: 'patents' },
    search: { runId: secondId },
  })
  await expect
    .element(screen.getByRole('heading', { name: '专利检索', exact: true }))
    .toBeVisible()
  await screen.unmount()
  queryClient.clear()
}, 30000)
