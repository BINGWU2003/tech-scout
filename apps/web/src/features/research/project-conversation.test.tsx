import type {
  ResearchProgressView,
  ResearchWorkspace,
} from '@tech-scout/contracts'
import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ProjectConversation } from './project-conversation'

function setup() {
  const runId = crypto.randomUUID()
  const plan = {
    directions: [
      {
        domain_id: 'edge',
        name: '边缘推理',
        explanation: '研究轻量化模型',
        keywords: ['边缘推理'],
        excluded_keywords: [],
        cpc_prefixes: [],
      },
    ],
    pages_per_keyword: 5 as const,
    from_year: 2020,
    to_year: 2026,
    risks: [],
  }
  const answer = {
    id: crypto.randomUUID(),
    startedAt: '2026-10-08T00:00:00Z',
    status: 'streaming' as const,
    text: '结合需求，',
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
        answer: null,
        pending: true,
        createdAt: answer.startedAt,
        plan: null,
        proposal: false,
        applied: false,
        outdated: false,
        hasResult: false,
      },
    ],
  }
  const event: ResearchProgressView = {
    sequence: 1,
    kind: 'answer_progress',
    status: 'running',
    node: 'planner',
    error: null,
    createdAt: answer.startedAt,
    answer,
  }
  const props = {
    workspace,
    busy: true,
    selectedPlan: workspace.selectedPlan,
    onAdd: () => {},
    onApply: () => {},
  }
  return { workspace, props, event, answer, plan }
}

it('流式正文先显示，完整回答后才展示方向卡片', async () => {
  const { workspace, props, event, answer, plan } = setup()
  const screen = await render(
    <ProjectConversation {...props} events={[event]} />
  )
  await expect.element(screen.getByText(answer.text)).toBeVisible()
  expect(
    screen.getByRole('button', { name: '加入计划：边缘推理' }).all()
  ).toHaveLength(0)
  const text = '结合需求，推荐边缘推理。'
  await screen.rerender(
    <ProjectConversation
      {...props}
      events={[event]}
      workspace={{
        ...workspace,
        messages: [
          {
            ...workspace.messages[0],
            text,
            pending: false,
            plan,
            recommendation: true,
            answer: { ...answer, text, status: 'completed' },
          },
        ],
      }}
    />
  )
  const intro = screen.getByText(text).element()
  const card = screen
    .getByRole('button', { name: '加入计划：边缘推理' })
    .element()
  expect(
    intro.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
})

it('旧流式事件不能覆盖刷新后已完成的回答', async () => {
  const { workspace, props, event, answer } = setup()
  const text = '最终完整回答'
  const screen = await render(
    <ProjectConversation
      {...props}
      events={[event]}
      workspace={{
        ...workspace,
        messages: [
          {
            ...workspace.messages[0],
            pending: false,
            answer: { ...answer, text, status: 'completed' },
          },
        ],
      }}
    />
  )
  await expect.element(screen.getByText(text)).toBeVisible()
  expect(screen.getByTestId('typewriter-cursor').all()).toHaveLength(0)
})

it('中断后保留已生成正文并标明尚未完成', async () => {
  const { workspace, props, answer } = setup()
  const screen = await render(
    <ProjectConversation
      {...props}
      workspace={{
        ...workspace,
        messages: [
          {
            ...workspace.messages[0],
            pending: false,
            answer: { ...answer, status: 'interrupted' },
          },
        ],
      }}
    />
  )
  await expect.element(screen.getByText(answer.text)).toBeVisible()
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('回答已中断，以上内容尚未完成。')
})
