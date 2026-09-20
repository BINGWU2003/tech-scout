import type { ResearchWorkspace } from '@tech-scout/contracts'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { SelectedPlanEditor } from './plan-editor'
import { ProjectConversation } from './project-conversation'
import { ResearchPlanLayout } from './research-plan-layout'
import '@/styles/index.css'

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
  researchCompleted: false,
  reachedStage: 'plan',
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

it.each([1280, 390])(
  '宽度 %i 时研究对话回到底部按钮按距离显示，回看不受新消息打断',
  async (width) => {
    await page.viewport(width, 844)
    const messages: ResearchWorkspace['messages'] = Array.from(
      { length: 25 },
      (_, index) => ({
        id: `message-${index}`,
        runId: null,
        role: 'assistant',
        reasoning: null,
        answer: null,
        pending: false,
        text: `研究建议 ${index + 1}`,
        createdAt: '2026-09-12T00:00:00Z',
        plan: null,
        recommendation: false,
        proposal: false,
        applied: false,
        outdated: false,
        hasResult: false,
      })
    )
    const ui = (currentMessages: typeof messages) => (
      <div className='flex h-[700px] flex-col p-4'>
        <ResearchPlanLayout
          directions={<p>已选方向</p>}
          composer={<textarea aria-label='研究需求' />}
          conversation={
            <ProjectConversation
              workspace={{ ...initial, messages: currentMessages }}
              busy={false}
              selectedPlan={plan}
              onApply={() => {}}
              onAdd={() => {}}
            />
          }
        />
      </div>
    )
    const screen = await render(ui(messages))
    const last = screen.getByText('研究建议 25', { exact: true })
    await expect.element(last).toBeVisible()
    const viewport = last.element().closest('[aria-label="研究对话记录"]')!
      .parentElement!.parentElement!
    const button = screen.getByRole('button', { name: '回到底部' })
    expect(button.all()).toHaveLength(0)
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight - 100
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(button.all()).toHaveLength(0)
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    await expect.element(button).toBeVisible()
    await screen.rerender(
      ui([...messages, { ...messages[0], id: 'new', text: '最新研究建议' }])
    )
    expect(viewport.scrollTop).toBe(0)
    await expect.element(button).toBeVisible()
    expect(button.element().getBoundingClientRect().bottom).toBeLessThan(
      screen
        .getByRole('textbox', { name: '研究需求' })
        .element()
        .getBoundingClientRect().top
    )
    await page.screenshot({
      path: `__screenshots__/project-scroll-to-bottom-${width}.png`,
    })
    await button.click()
    await expect
      .element(screen.getByText('最新研究建议', { exact: true }))
      .toBeVisible()
    await expect.poll(() => button.all().length).toBe(0)
    await expect
      .element(screen.getByRole('textbox', { name: '研究需求' }))
      .toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)
    await screen.unmount()
  }
)

it.each([false, true])(
  '已开始研究后锁定编辑和重复启动（完成：%s）',
  async (completed) => {
    const onStart = vi.fn()
    const onSave = vi.fn()
    const screen = await render(
      <SelectedPlanEditor
        workspace={{
          ...initial,
          researchCompleted: completed,
          executionRunId: 'execution',
          reachedStage: completed ? 'report' : 'patents',
        }}
        busy={false}
        onStart={onStart}
        onSave={onSave}
        onDirty={vi.fn()}
      />
    )
    await expect
      .element(screen.getByRole('textbox', { name: '方向名称' }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('textbox', { name: '方向描述' }))
      .toHaveValue('已选方向范围')
    await expect
      .element(screen.getByRole('button', { name: '开始研究', exact: true }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '增加方向' }))
      .toBeDisabled()
    expect(onStart).not.toHaveBeenCalled()
    expect(onSave).not.toHaveBeenCalled()
  }
)

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
      answer: null,
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
