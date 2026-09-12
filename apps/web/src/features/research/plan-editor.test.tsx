import type { ResearchWorkspace } from '@tech-scout/contracts'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SelectedPlanEditor } from './plan-editor'
import { ProjectConversation } from './project-conversation'

const direction = (id: string) => ({
  domain_id: id,
  name: id,
  explanation: `${id}范围`,
  keywords: [],
  excluded_keywords: [],
  cpc_prefixes: [],
})
const plan = {
  from_year: 2020,
  to_year: 2026,
  risks: [],
  directions: [direction('已选方向')],
}
const initial: ResearchWorkspace = {
  revision: 1,
  selectedPlan: plan,
  candidates: { ...plan, directions: [direction('候选方向')] },
  messages: [],
  activeRunId: null,
  executionRunId: null,
  latestResultRunId: null,
  resultOutdated: false,
  blocked: false,
}

it('候选刷新保留未保存编辑，可直接保存或开始研究', async () => {
  const save = vi.fn(),
    start = vi.fn(),
    dirty = vi.fn()
  function Editor({ workspace }: { workspace: ResearchWorkspace }) {
    const [draft, setDraft] = useState<ResearchWorkspace['selectedPlan']>()
    return (
      <SelectedPlanEditor
        workspace={workspace}
        initialPlan={draft}
        busy={false}
        onSave={save}
        onStart={start}
        onDirty={(changed, plan) => {
          dirty(changed)
          setDraft(changed ? plan : undefined)
        }}
      />
    )
  }
  const screen = await render(<Editor workspace={initial} />)
  await screen.getByRole('textbox', { name: '方向描述' }).fill('我修改的描述')
  await screen.rerender(
    <Editor
      workspace={{
        ...initial,
        candidates: { ...plan, directions: [direction('刷新候选')] },
      }}
    />
  )
  await expect
    .element(screen.getByRole('textbox', { name: '方向名称' }))
    .toHaveValue('已选方向')
  await expect
    .element(screen.getByRole('textbox', { name: '方向描述' }))
    .toHaveValue('我修改的描述')
  await expect
    .element(screen.getByRole('button', { name: '保存并开始研究' }))
    .toBeEnabled()
  await screen.getByRole('button', { name: '保存调整', exact: true }).click()
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      directions: [expect.objectContaining({ explanation: '我修改的描述' })],
    })
  )
  expect(start).not.toHaveBeenCalled()
})

it('候选加入与删除由保存提交，空计划不能执行', async () => {
  const save = vi.fn(),
    start = vi.fn()
  function Editor() {
    const [workspace, setWorkspace] = useState(initial)
    const [draft, setDraft] = useState<ResearchWorkspace['selectedPlan']>()
    const selected = draft ?? workspace.selectedPlan
    const message = (id: string, outdated: boolean) => ({
      id,
      runId: null,
      role: 'assistant' as const,
      reasoning: null,
      pending: false,
      text: '推荐方向',
      createdAt: '2026-09-12T00:00:00Z',
      plan: workspace.candidates,
      recommendation: true,
      proposal: false,
      applied: false,
      outdated,
      hasResult: false,
    })
    return (
      <>
        <ProjectConversation
          workspace={{
            ...workspace,
            messages: [message('old', true), message('latest', false)],
          }}
          projectId={crypto.randomUUID()}
          busy={false}
          selectedPlan={selected}
          onApply={() => {}}
          onAdd={(d) =>
            setDraft({ ...selected, directions: [...selected.directions, d] })
          }
        />
        <SelectedPlanEditor
          initialPlan={draft}
          key={workspace.revision}
          workspace={workspace}
          busy={false}
          onDirty={(changed, plan) => setDraft(changed ? plan : undefined)}
          onStart={start}
          onSave={async (plan) => {
            save(plan)
            setDraft(undefined)
            setWorkspace({
              ...workspace,
              selectedPlan: plan,
              revision: workspace.revision + 1,
            })
          }}
        />
      </>
    )
  }
  const screen = await render(<Editor />)
  expect(
    screen.getByRole('button', { name: '加入计划：候选方向' }).all()
  ).toHaveLength(1)
  await screen.getByRole('button', { name: '加入计划：候选方向' }).click()
  expect(save).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: '保存调整', exact: true }).click()
  expect(
    save.mock.calls[0][0].directions.map((d: { name: string }) => d.name)
  ).toEqual(['已选方向', '候选方向'])
  await screen.getByRole('button', { name: '移除：已选方向' }).click()
  await screen.getByRole('button', { name: '移除：候选方向' }).click()
  await screen.getByRole('button', { name: '保存调整', exact: true }).click()
  await expect
    .element(screen.getByRole('button', { name: '开始研究' }))
    .toBeDisabled()
  expect(save.mock.lastCall?.[0].directions).toEqual([])
})
