import type {
  ResearchReasoning,
  ResearchProgressView,
  ResearchWorkspace,
} from '@tech-scout/contracts'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ProjectConversation } from './project-conversation'
import { ReasoningPanel } from './reasoning-panel'

const reasoning: ResearchReasoning = {
  id: crypto.randomUUID(),
  status: 'thinking',
  text: '比较不同方向的技术范围。',
  startedAt: '2026-09-12T00:00:00Z',
  durationMs: 2000,
  truncated: false,
}

it('思考实时展开，进入回答时折叠，仍可回看思考内容', async () => {
  const screen = await render(<ReasoningPanel reasoning={reasoning} />)
  await expect
    .element(screen.getByRole('button', { name: /正在思考/ }))
    .toHaveAttribute('aria-expanded', 'true')
  await expect.element(screen.getByText(reasoning.text)).toBeVisible()
  await screen.rerender(
    <ReasoningPanel
      reasoning={{ ...reasoning, status: 'answering', durationMs: 3200 }}
    />
  )
  await expect
    .element(screen.getByRole('button', { name: /思考已完成/ }))
    .toHaveAttribute('aria-expanded', 'false')
  await screen.getByRole('button', { name: /思考已完成/ }).click()
  await expect.element(screen.getByText(reasoning.text)).toBeVisible()
})

it('先思考，再流式说明，最后展示方向卡片，正文顺序保持一致', async () => {
  const runId = crypto.randomUUID()
  const plan = {
    from_year: 2020,
    to_year: 2026,
    risks: [],
    directions: [
      {
        domain_id: 'edge',
        name: '边缘推理',
        explanation: '关注轻量化算法',
        keywords: [],
        excluded_keywords: [],
        cpc_prefixes: [],
      },
    ],
  }
  const workspace: ResearchWorkspace = {
    researchCompleted: false,
    reachedStage: 'plan',
    revision: 0,
    selectedPlan: { ...plan, directions: [] },
    candidates: null,
    activeRunId: runId,
    executionRunId: null,
    latestResultRunId: null,
    resultOutdated: false,
    blocked: true,
    messages: [
      {
        id: 'reply',
        runId,
        role: 'assistant',
        text: '',
        reasoning: null,
        answer: null,
        pending: true,
        plan: null,
        proposal: false,
        applied: false,
        outdated: false,
        hasResult: false,
        createdAt: reasoning.startedAt,
      },
    ],
  }
  const props = {
    workspace,
    projectId: crypto.randomUUID(),
    busy: true,
    selectedPlan: workspace.selectedPlan,
    onAdd: () => {},
    onApply: () => {},
  }
  const events: ResearchProgressView[] = [
    {
      sequence: 1,
      kind: 'reasoning_progress',
      status: 'running',
      node: 'planner',
      error: null,
      createdAt: reasoning.startedAt,
      reasoning,
      answer: null,
    },
  ]
  const screen = await render(
    <ProjectConversation {...props} events={events} />
  )
  await expect.element(screen.getByText(reasoning.text)).toBeVisible()
  expect(
    screen.getByRole('button', { name: '加入计划：边缘推理' }).all()
  ).toHaveLength(0)
  const answer = {
    id: reasoning.id,
    startedAt: reasoning.startedAt,
    status: 'streaming' as const,
    text: '结合你的需求，',
  }
  events.push({
    ...events[0],
    sequence: 2,
    kind: 'answer_progress',
    reasoning: { ...reasoning, status: 'answering' },
    answer,
  })
  await screen.rerender(<ProjectConversation {...props} events={events} />)
  await expect
    .element(screen.getByRole('button', { name: /思考已完成/ }))
    .toHaveAttribute('aria-expanded', 'false')
  await expect.element(screen.getByText(answer.text)).toBeVisible()
  expect(
    screen.getByRole('button', { name: '加入计划：边缘推理' }).all()
  ).toHaveLength(0)
  const text = '结合你的需求，建议优先研究以下方向。'
  await screen.rerender(
    <ProjectConversation
      {...props}
      events={events}
      workspace={{
        ...workspace,
        messages: [
          {
            ...workspace.messages[0],
            text,
            pending: false,
            plan,
            recommendation: true,
            reasoning: { ...reasoning, status: 'completed' },
            answer: { ...answer, text, status: 'completed' },
          },
        ],
      }}
    />
  )
  const thought = screen.getByRole('button', { name: /思考已完成/ }).element()
  const intro = screen.getByText(text).element()
  const card = screen
    .getByRole('button', { name: '加入计划：边缘推理' })
    .element()
  expect(
    thought.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    intro.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  await expect.element(screen.getByText(text)).toBeVisible()
})

it('新一次尝试重新展开，无内容时显示等待状态', async () => {
  const screen = await render(
    <ReasoningPanel reasoning={{ ...reasoning, status: 'interrupted' }} />
  )
  await expect
    .element(screen.getByRole('button', { name: /思考已中断/ }))
    .toHaveAttribute('aria-expanded', 'false')
  await screen.rerender(
    <ReasoningPanel
      reasoning={{ ...reasoning, id: crypto.randomUUID(), text: '' }}
    />
  )
  await expect
    .element(screen.getByRole('button', { name: /正在思考/ }))
    .toHaveAttribute('aria-expanded', 'true')
  await expect.element(screen.getByText('正在等待模型返回内容…')).toBeVisible()
})

it('事件补充消息内实时思考，但旧事件不能覆盖刷新后已完成的历史记录', async () => {
  const runId = crypto.randomUUID()
  const plan = { directions: [], from_year: 2020, to_year: 2026, risks: [] }
  const workspace: ResearchWorkspace = {
    researchCompleted: false,
    reachedStage: 'plan',
    revision: 0,
    selectedPlan: plan,
    candidates: null,
    activeRunId: runId,
    executionRunId: null,
    latestResultRunId: null,
    blocked: true,
    resultOutdated: false,
    messages: [
      {
        id: 'reply',
        role: 'assistant',
        runId,
        text: '',
        createdAt: reasoning.startedAt,
        pending: true,
        reasoning: null,
        answer: null,
        plan: null,
        proposal: false,
        applied: false,
        outdated: false,
        hasResult: false,
      },
    ],
  }
  const props = {
    workspace,
    projectId: crypto.randomUUID(),
    busy: true,
    selectedPlan: plan,
    onAdd: () => {},
    onApply: () => {},
    events: [
      {
        sequence: 1,
        kind: 'reasoning_progress',
        createdAt: reasoning.startedAt,
        status: 'running' as const,
        node: 'planner',
        error: null,
        reasoning,
        answer: null,
      },
    ],
  }
  const screen = await render(<ProjectConversation {...props} />)
  await expect.element(screen.getByText(reasoning.text)).toBeVisible()
  await screen.rerender(
    <ProjectConversation
      {...props}
      workspace={{
        ...workspace,
        messages: [
          {
            ...workspace.messages[0],
            text: '这是最终回答。',
            pending: false,
            reasoning: { ...reasoning, status: 'completed' },
          },
        ],
      }}
    />
  )
  await expect.element(screen.getByText('这是最终回答。')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: /思考已完成/ }))
    .toHaveAttribute('aria-expanded', 'false')
})
