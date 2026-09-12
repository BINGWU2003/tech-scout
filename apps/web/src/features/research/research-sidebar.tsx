import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { MessageSquare, Plus, RefreshCw } from 'lucide-react'
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

export function ResearchNewButton() {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild tooltip='新建研究'>
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
  const client = useResearchClient()
  const query = useQuery(
    { queryKey: ['research', 'projects'], queryFn: researchApi.projects },
    client
  )
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarGroup>
      <SidebarGroupLabel className='mt-4'>研究记录</SidebarGroupLabel>
      <SidebarGroupContent>
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
        <SidebarMenu>
          {query.data?.map((project) => (
            <SidebarMenuItem key={project.id}>
              <SidebarMenuButton
                asChild
                tooltip={project.title}
                isActive={
                  pathname === `/research/${project.id}` ||
                  pathname.startsWith(`/research/${project.id}/`)
                }
              >
                <Link
                  to='/research/$projectId'
                  params={{ projectId: project.id }}
                  onClick={() => setOpenMobile(false)}
                  title={project.title}
                >
                  <MessageSquare />
                  <span>{project.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        {(query.data?.length ?? 0) >= 100 && (
          <p className='px-2 py-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden'>
            显示最近 100 个项目
          </p>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
