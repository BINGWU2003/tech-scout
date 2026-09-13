import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import {
  Sidebar,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { researchApi } from '@/lib/research-api'
import { ResearchCache } from './research-cache'
import { ResearchSidebar, ResearchTaskLabel } from './research-sidebar'
import '@/styles/index.css'

afterEach(() => vi.restoreAllMocks())

async function sidebarFixture(active: boolean, collapsed = false) {
  await page.viewport(1280, 900)
  const project = {
    id: crypto.randomUUID(),
    title: '固态电池',
    question: '固态电池',
    createdAt: new Date().toISOString(),
    activity: {
      runId: crypto.randomUUID(),
      status: 'running' as const,
      sequence: 1,
      label: '正在研究…',
    },
  }
  const other = { ...project, id: crypto.randomUUID(), title: '边缘计算' }
  let projects = [project, other]
  vi.spyOn(researchApi, 'projects').mockImplementation(async () => projects)
  const remove = vi
    .spyOn(researchApi, 'deleteProject')
    .mockImplementation(async () => {
      projects = [other]
      return { deleted: true, runIds: [project.activity.runId] }
    })
  const root = createRootRoute({
    component: () => (
      <ResearchCache>
        <SidebarProvider defaultOpen={!collapsed}>
          <Sidebar collapsible='icon'>
            <ResearchSidebar />
          </Sidebar>
          <SidebarTrigger aria-label='打开侧栏' />
          <Outlet />
        </SidebarProvider>
      </ResearchCache>
    ),
  })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/research',
    component: () => <main>新建研究页面</main>,
  })
  const detail = createRoute({
    getParentRoute: () => root,
    path: '/research/$projectId',
    component: () => <main>研究详情页面</main>,
  })
  const router = createRouter({
    routeTree: root.addChildren([home, detail]),
    history: createMemoryHistory({
      initialEntries: [`/research/${active ? project.id : other.id}`],
    }),
  })
  const screen = await render(<RouterProvider router={router} />)
  await expect.element(screen.getByText('研究详情页面')).toBeVisible()
  return { screen, router, project, other, remove }
}

it('删除菜单不打开任务；取消不提交，失败可重试，删除当前任务回到新建研究', async () => {
  const { screen, router, project, remove } = await sidebarFixture(true)
  await screen.getByRole('button', { name: '固态电池的操作' }).click()
  await page.getByRole('menuitem', { name: '删除任务' }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  await expect.element(page.getByText('正在进行的研究将先停止。')).toBeVisible()
  await expect
    .element(page.getByRole('alertdialog'))
    .toHaveStyle({ opacity: '1' })
  await page.screenshot({ path: '__screenshots__/research-delete-desktop.png' })
  expect(router.state.location.pathname).toBe(`/research/${project.id}`)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  expect(remove).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: '固态电池的操作' }).click()
  await page.getByRole('menuitem', { name: '删除任务' }).click()
  remove.mockRejectedValueOnce(new Error('暂不可用'))
  await page.getByRole('button', { name: '删除任务', exact: true }).click()
  await expect.element(page.getByRole('alert')).toHaveTextContent('删除未完成')
  expect(router.state.location.pathname).toBe(`/research/${project.id}`)
  await page.getByRole('button', { name: '重试删除' }).click()
  await expect.element(screen.getByText('新建研究页面')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: '固态电池的操作' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: '边缘计算的操作' }))
    .toBeInTheDocument()
  expect(remove).toHaveBeenCalledTimes(2)
})

it('删除其他任务留在当前页，提交期间阻止重复操作', async () => {
  const { screen, router, other, project, remove } = await sidebarFixture(false)
  let finish!: (result: { deleted: true; runIds: string[] }) => void
  remove.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await screen.getByRole('button', { name: '固态电池的操作' }).click()
  await page.getByRole('menuitem', { name: '删除任务' }).click()
  await page.getByRole('button', { name: '删除任务', exact: true }).click()
  await expect
    .element(page.getByRole('button', { name: '正在删除…' }))
    .toBeDisabled()
  await expect
    .element(page.getByRole('button', { name: '取消', exact: true }))
    .toBeDisabled()
  expect(remove).toHaveBeenCalledOnce()
  finish({ deleted: true, runIds: [project.activity.runId] })
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  expect(router.state.location.pathname).toBe(`/research/${other.id}`)
})

it('收起侧栏后仍可从历史菜单删除任务', async () => {
  const { screen, remove } = await sidebarFixture(false, true)
  await screen.getByRole('button', { name: '历史记录' }).click()
  await page.getByRole('menuitem', { name: '固态电池的操作' }).click()
  await page.getByRole('menuitem', { name: '删除任务', exact: true }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: '删除任务', exact: true }).click()
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  expect(remove).toHaveBeenCalledOnce()
})

it('手机侧栏可确认删除并关闭侧栏返回新建研究', async () => {
  const { screen, remove } = await sidebarFixture(true)
  await page.viewport(390, 844)
  await screen.getByRole('button', { name: '打开侧栏' }).click()
  await page.getByRole('button', { name: '固态电池的操作' }).click()
  await page.getByRole('menuitem', { name: '删除任务', exact: true }).click()
  await expect.element(page.getByRole('alertdialog')).toBeVisible()
  await expect
    .element(page.getByRole('alertdialog'))
    .toHaveStyle({ opacity: '1' })
  await page.screenshot({ path: '__screenshots__/research-delete-mobile.png' })
  await page.getByRole('button', { name: '删除任务', exact: true }).click()
  await expect.element(screen.getByText('新建研究页面')).toBeVisible()
  await expect.element(page.getByRole('alertdialog')).not.toBeInTheDocument()
  expect(remove).toHaveBeenCalledOnce()
})

it('运行状态只显示在对应任务，结束后保留完成文案并移除 loading', async () => {
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
      <ResearchTaskLabel
        project={{
          ...project,
          activity: {
            ...running.activity,
            status: 'completed',
            sequence: 2,
            label: '研究已完成',
          },
        }}
      />
    </ResearchCache>
  )
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('研究已完成')
  expect(
    screen.container.querySelector('.motion-safe\\:animate-spin')
  ).toBeNull()
  await expect.element(screen.getByText('固态电池')).toBeVisible()
})
