import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronUp,
  History,
  MessageSquare,
  LoaderCircle,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useId, useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '@/components/ui/sidebar'
import { resetApiErrors } from '@/lib/api-error-notifications'
import { researchApi } from '@/lib/research-api'
import { useResearchClient } from './research-cache'
import { isExecuting } from './use-research-run'

export function ResearchTaskLabel({
  project,
}: {
  project: Awaited<ReturnType<typeof researchApi.projects>>[number]
}) {
  const client = useResearchClient()
  const id = project.activity?.runId
  const summary = useQuery(
    {
      queryKey: ['research', id, 'summary'],
      queryFn: () => researchApi.summary(id!),
      enabled: false,
    },
    client
  )
  const events = useQuery(
    {
      queryKey: ['research', id, 'events'],
      queryFn: () => researchApi.events(id!),
      enabled: false,
    },
    client
  )
  const connection = useQuery(
    {
      queryKey: ['research', id, 'disconnected'],
      queryFn: () => false,
      enabled: false,
    },
    client
  )
  const run =
    summary.data && summary.data.sequence >= (project.activity?.sequence ?? 0)
      ? summary.data
      : undefined
  const active = id && isExecuting(run?.status ?? project.activity?.status)
  const reasoning = [...(events.data ?? [])]
    .reverse()
    .find((event) => event.reasoning)?.reasoning
  const label = connection.data
    ? '连接恢复中…'
    : !run
      ? project.activity?.label
      : run.status === 'queued' || !run.ready
        ? '正在准备回复…'
        : run.node && !['context', 'planner', 'plan_gate'].includes(run.node)
          ? '正在研究…'
          : reasoning?.status === 'answering' ||
              reasoning?.status === 'completed'
            ? '正在生成回答…'
            : '正在思考…'
  return (
    <>
      {active ? (
        <LoaderCircle
          className='size-4 shrink-0 motion-safe:animate-spin'
          aria-hidden='true'
        />
      ) : (
        <MessageSquare className='size-4 shrink-0' aria-hidden='true' />
      )}
      <span className='min-w-0 flex-1'>
        <span className='block truncate'>{project.title}</span>
        {active && (
          <span
            role='status'
            className='block truncate text-[11px] font-normal text-muted-foreground'
          >
            {label}
          </span>
        )}
      </span>
    </>
  )
}

const RECENT_PROJECT_LIMIT = 10

export function ResearchNewButton() {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          tooltip='新建研究'
          className='bg-sidebar-accent font-medium'
        >
          <Link to='/research' onClick={() => setOpenMobile(false)}>
            <Plus />
            <span>新建研究</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function ResearchSidebar() {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const client = useResearchClient()
  const query = useQuery(
    {
      queryKey: ['research', 'projects'],
      queryFn: researchApi.projects,
      refetchInterval: 5000,
    },
    client
  )
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { setOpenMobile } = useSidebar()
  const projects = query.data ?? []
  const visibleProjects = expanded
    ? projects
    : projects.slice(0, RECENT_PROJECT_LIMIT)
  const isProjectActive = (projectId: string) =>
    pathname === `/research/${projectId}` ||
    pathname.startsWith(`/research/${projectId}/`)

  return (
    <>
      <SidebarGroup className='hidden shrink-0 group-data-[collapsible=icon]:flex'>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  tooltip='历史记录'
                  aria-label='历史记录'
                  isActive={projects.some((project) =>
                    isProjectActive(project.id)
                  )}
                >
                  <History />
                  <span>历史记录</span>
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side='right'
                align='start'
                sideOffset={4}
                className='w-72 max-w-[calc(100vw-4rem)]'
              >
                <DropdownMenuLabel>最近研究</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {query.isPending && (
                  <p
                    role='status'
                    className='px-2 py-3 text-xs text-muted-foreground'
                  >
                    正在读取研究记录…
                  </p>
                )}
                {query.isError && (
                  <DropdownMenuItem
                    onSelect={(event) => {
                      event.preventDefault()
                      resetApiErrors()
                      void query.refetch()
                    }}
                  >
                    <RefreshCw />
                    刷新研究记录
                  </DropdownMenuItem>
                )}
                {query.data?.length === 0 && (
                  <p className='px-2 py-3 text-xs text-muted-foreground'>
                    开始你的第一项研究
                  </p>
                )}
                {projects.slice(0, RECENT_PROJECT_LIMIT).map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    asChild
                    className={
                      isProjectActive(project.id)
                        ? 'bg-accent font-medium'
                        : undefined
                    }
                  >
                    <Link
                      to='/research/$projectId'
                      params={{ projectId: project.id }}
                      title={project.title}
                      aria-current={
                        isProjectActive(project.id) ? 'page' : undefined
                      }
                    >
                      <ResearchTaskLabel project={project} />
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup className='min-h-0 flex-1 group-data-[collapsible=icon]:hidden'>
        <SidebarGroupLabel>研究记录</SidebarGroupLabel>
        <SidebarGroupContent className='min-h-0 flex-1 overflow-y-auto overscroll-contain'>
          {query.isPending && (
            <p
              role='status'
              className='px-2 py-3 text-xs group-data-[collapsible=icon]:hidden'
            >
              正在读取研究记录…
            </p>
          )}
          {query.isError && (
            <SidebarMenuButton
              onClick={() => {
                resetApiErrors()
                void query.refetch()
              }}
            >
              <RefreshCw />
              <span>刷新研究记录</span>
            </SidebarMenuButton>
          )}
          {query.data?.length === 0 && (
            <p className='px-2 py-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden'>
              开始你的第一项研究
            </p>
          )}
          <SidebarMenu id={listId}>
            {visibleProjects.map((project) => (
              <SidebarMenuItem key={project.id}>
                <SidebarMenuButton
                  asChild
                  tooltip={project.title}
                  className={project.activity ? 'h-12' : undefined}
                  isActive={isProjectActive(project.id)}
                >
                  <Link
                    to='/research/$projectId'
                    params={{ projectId: project.id }}
                    onClick={() => setOpenMobile(false)}
                    title={project.title}
                  >
                    <ResearchTaskLabel project={project} />
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          {expanded && projects.length >= 100 && (
            <p className='px-2 py-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden'>
              显示最近 100 个项目
            </p>
          )}
        </SidebarGroupContent>
        {projects.length > RECENT_PROJECT_LIMIT && (
          <SidebarMenuButton
            className='mt-1 shrink-0 text-muted-foreground'
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <ChevronUp /> : <ChevronDown />}
            <span>{expanded ? '收起记录' : '展开更多'}</span>
          </SidebarMenuButton>
        )}
      </SidebarGroup>
    </>
  )
}
