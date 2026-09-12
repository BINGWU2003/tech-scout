import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { useLayout } from '@/context/layout-provider'
import {
  ResearchSidebar,
  ResearchNewButton,
} from '@/features/research/research-sidebar'
import { useAuthStore } from '@/stores/auth-store'
import { AppTitle } from './app-title'
import { sidebarData } from './data/sidebar-data'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const user = useAuthStore((state) => state.auth.user)
  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <AppTitle />
        <ResearchNewButton />
      </SidebarHeader>
      <SidebarContent className='gap-0 overflow-hidden'>
        {sidebarData.navGroups.map((props) => (
          <NavGroup key={props.title} {...props} />
        ))}
        <ResearchSidebar />
      </SidebarContent>
      <SidebarFooter className='gap-0 border-t border-sidebar-border'>
        {user?.role === 'admin' && <NavGroup {...sidebarData.adminNav} />}
        <NavUser
          user={{
            name: user?.username ?? '用户',
            email: user?.email ?? '',
            avatar: sidebarData.user.avatar,
          }}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
