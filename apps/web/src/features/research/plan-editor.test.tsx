import type { ResearchWorkspace } from '@tech-scout/contracts'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SelectedPlanEditor } from './plan-editor'

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

it('候选刷新保留已选和未保存编辑，保存后才能检索', async () => {
  const save = vi.fn(),
    start = vi.fn(),
    dirty = vi.fn()
  const screen = await render(
    <SelectedPlanEditor
      workspace={initial}
      busy={false}
      onSave={save}
      onStart={start}
      onDirty={dirty}
    />
  )
  await screen.getByRole('textbox', { name: '方向描述' }).fill('我修改的描述')
  await screen.rerender(
    <SelectedPlanEditor
      workspace={{
        ...initial,
        candidates: { ...plan, directions: [direction('刷新候选')] },
      }}
      busy={false}
      onSave={save}
      onStart={start}
      onDirty={dirty}
    />
  )
  await expect
    .element(screen.getByRole('textbox', { name: '方向名称' }))
    .toHaveValue('已选方向')
  await expect
    .element(screen.getByRole('textbox', { name: '方向描述' }))
    .toHaveValue('我修改的描述')
  await expect
    .element(screen.getByRole('button', { name: '确认计划并开始检索' }))
    .toBeDisabled()
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
    return (
      <SelectedPlanEditor
        key={workspace.revision}
        workspace={workspace}
        busy={false}
        onDirty={() => {}}
        onStart={start}
        onSave={async (plan) => {
          save(plan)
          setWorkspace({
            ...workspace,
            selectedPlan: plan,
            revision: workspace.revision + 1,
          })
        }}
      />
    )
  }
  const screen = await render(<Editor />)
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
    .element(screen.getByRole('button', { name: '确认计划并开始检索' }))
    .toBeDisabled()
  expect(save.mock.lastCall?.[0].directions).toEqual([])
})
