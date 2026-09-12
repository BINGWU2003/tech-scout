import { researchSummaryViewSchema } from '@tech-scout/contracts'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { PlanRunFeedback } from './plan-run-feedback'

const run = researchSummaryViewSchema.parse({
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  question: '固态电池',
  status: 'running',
  sequence: 1,
  createdAt: '2026-09-12T00:00:00Z',
  updatedAt: '2026-09-12T00:00:00Z',
  ready: true,
  node: 'planner',
  error: null,
  budget: null,
  releaseId: null,
  fromYear: 2020,
  toYear: 2026,
  domains: [],
  plan: null,
  confirmedPlan: null,
  pendingCandidateIds: [],
  candidateCount: 0,
  hasResult: false,
})

it('生成时可停止，停止后不误显示失败重试；待确认与历史没有过程控件', async () => {
  const onAction = vi.fn()
  const props = {
    run,
    events: [],
    disconnected: false,
    busy: false,
    readOnly: false,
    onAction,
  }
  const screen = await render(<PlanRunFeedback {...props} />)
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('正在思考…')
  await screen.getByRole('button', { name: '停止', exact: true }).click()
  expect(onAction).toHaveBeenCalledWith('pause')
  await screen.rerender(<PlanRunFeedback {...props} busy />)
  await expect
    .element(screen.getByRole('button', { name: '正在停止…' }))
    .toBeDisabled()
  await screen.rerender(
    <PlanRunFeedback {...props} run={{ ...run, status: 'recoverable' }} />
  )
  await expect.element(screen.getByRole('status')).toHaveTextContent('已停止')
  await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
  await screen.rerender(
    <PlanRunFeedback {...props} run={{ ...run, status: 'awaiting_plan' }} />
  )
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  await screen.rerender(<PlanRunFeedback {...props} readOnly />)
  await expect.element(screen.getByRole('button')).not.toBeInTheDocument()
})

it('失败才提供重试，断线复用同一条进度提示', async () => {
  const onAction = vi.fn()
  const props = {
    run,
    events: [],
    disconnected: true,
    busy: false,
    readOnly: false,
    onAction,
  }
  const screen = await render(<PlanRunFeedback {...props} />)
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('连接恢复中…')
  await screen.rerender(
    <PlanRunFeedback {...props} run={{ ...run, status: 'failed' }} />
  )
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('生成失败，请重试。')
  await screen.getByRole('button', { name: '重试', exact: true }).click()
  expect(onAction).toHaveBeenCalledWith('retry')
  await expect
    .element(screen.getByRole('button', { name: '停止', exact: true }))
    .not.toBeInTheDocument()
})
