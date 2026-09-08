import {
  Command,
  Telescope,
  Building2,
  FileSearch,
  Users,
  Settings,
} from 'lucide-react'
import { type SidebarData } from '../types'
export const sidebarData: SidebarData = {
  user: { name: 'Tech Scout', email: '', avatar: '' },
  teams: [{ name: 'Tech Scout', logo: Command, plan: '技术研究工作台' }],
  navGroups: [
    {
      title: '研究与数据',
      items: [
        { title: '研究工作台', url: '/research', icon: Telescope },
        { title: '企业库', url: '/companies', icon: Building2 },
        { title: '专利库', url: '/patents', icon: FileSearch },
      ],
    },
    {
      title: '账号',
      items: [
        { title: '账号设置', url: '/settings', icon: Settings },
        { title: '用户管理', url: '/users', icon: Users },
      ],
    },
  ],
}
