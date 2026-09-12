import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ResearchCache } from './research-cache'
import { ResearchTaskLabel } from './research-sidebar'

it('运行状态只显示在对应任务，结束后移除 loading', async () => {
  const project = {
    id: crypto.randomUUID(),
    title: '固态电池',
    question: '固态电池',
    createdAt: new Date().toISOString(),
  }
  const running = {
    ...project,
    activity: {
      runId: crypto.randomUUID(),
      status: 'running' as const,
      sequence: 1,
      label: '正在研究…',
    },
  }
  const screen = await render(
    <ResearchCache>
      <div>
        <ResearchTaskLabel project={running} />
      </div>
      <div>
        <ResearchTaskLabel
          project={{ ...project, id: crypto.randomUUID(), title: '边缘计算' }}
        />
      </div>
    </ResearchCache>
  )
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('正在研究…')
  await expect.element(screen.getByText('边缘计算')).toBeVisible()
  await screen.rerender(
    <ResearchCache>
      <ResearchTaskLabel project={{ ...project, activity: null }} />
    </ResearchCache>
  )
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  await expect.element(screen.getByText('固态电池')).toBeVisible()
})
