import type {
  ResearchReasoning,
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

it('实时展开，完成自动折叠，仍可手动查看真实思考内容', async () => {
  const screen = await render(<ReasoningPanel reasoning={reasoning} />)
  await expect.element(screen.getByText(reasoning.text)).toBeVisible()
  await screen.rerender(
    <ReasoningPanel
      reasoning={{ ...reasoning, status: 'completed', durationMs: 3200 }}
    />
  )
  await expect
    .element(screen.getByRole('button', { name: /思考已完成/ }))
    .toHaveAttribute('aria-expanded', 'false')
  await screen.getByRole('button', { name: /思考已完成/ }).click()
  await expect.element(screen.getByText(reasoning.text)).toBeVisible()
})

it('新一次尝试重新展开，无内容时只显示真实状态', async () => {
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
  await expect.element(screen.getByText('正在等待模型返回内容…')).toBeVisible()
})

it('事件补充消息内实时思考，但旧事件不能覆盖刷新后已完成的历史记录', async () => {
  const runId = crypto.randomUUID()
  const plan = { directions: [], from_year: 2020, to_year: 2026, risks: [] }
  const workspace: ResearchWorkspace = {
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
