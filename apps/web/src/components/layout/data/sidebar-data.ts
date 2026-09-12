import { Command, Building2, FileSearch, Users } from 'lucide-react'
import { type SidebarData } from '../types'
export const sidebarData: SidebarData = {
  user: { name: 'Tech Scout', email: '', avatar: '' },
  teams: [{ name: 'Tech Scout', logo: Command, plan: '技术研究工作台' }],
  navGroups: [
    {
      title: '',
      items: [
        { title: '企业库', url: '/companies', icon: Building2 },
        { title: '专利库', url: '/patents', icon: FileSearch },
      ],
    },
  ],
  adminNav: {
    title: '',
    items: [{ title: '用户管理', url: '/users', icon: Users }],
  },
}
