import { describe, expect, it } from 'vitest'
import { sidebarData } from './sidebar-data'

describe('侧边栏导航数据', () => {
  it('使用中文显示用户管理入口', () => {
    const usersItem = sidebarData.navGroups
      .flatMap((group) => group.items)
      .find((item) => item.url === '/users')

    expect(usersItem?.title).toBe('用户管理')
  })
})
