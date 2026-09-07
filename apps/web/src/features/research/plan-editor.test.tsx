import { researchSummaryViewSchema } from '@tech-scout/contracts'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { PlanEditor } from './plan-editor'

describe('按需采集计划确认', () => {
  it('空目录可以编辑新方向，点击确认前不提交任务', async () => {
    const run = researchSummaryViewSchema.parse({
      id: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      question: '固态电池',
      status: 'awaiting_plan',
      sequence: 1,
      createdAt: '2026-09-07',
      updatedAt: '2026-09-07',
      ready: true,
      node: 'plan_gate',
      error: null,
      budget: null,
      releaseId: null,
      sourceMode: 'browser',
      fromYear: 1800,
      toYear: 2026,
      domains: [],
      plan: null,
      confirmedPlan: null,
      pendingCandidateIds: [],
      candidateCount: 0,
      hasResult: false,
    })
    const submit = vi.fn().mockResolvedValue(undefined)
    const screen = await render(
      <PlanEditor run={run} busy={false} onSubmit={submit} />
    )
    await screen.getByRole('textbox', { name: '方向名称' }).fill('固态电解质')
    expect(submit).not.toHaveBeenCalled()
    await screen.getByRole('button', { name: '确认检索并开始采集' }).click()
    expect(submit).toHaveBeenCalledOnce()
    expect(submit.mock.calls[0][0]).toMatchObject({
      kind: 'confirm_plan',
      plan: { directions: [{ name: '固态电解质' }] },
    })
  })
})
