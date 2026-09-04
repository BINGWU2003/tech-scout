import { describe, expect, it } from 'vitest'
import {
  loginSchema,
  registerSchema,
  userListQuerySchema,
  usernameSchema,
} from './auth.js'

describe('认证契约', () => {
  it('规范化用户名和注册邮箱', () => {
    expect(usernameSchema.parse('  Alice_01 ')).toBe('alice_01')
    expect(
      registerSchema.parse({
        username: 'Alice_01',
        email: ' Alice@Example.COM ',
        password: 'correct horse battery staple',
      })
    ).toMatchObject({ username: 'alice_01', email: 'Alice@Example.COM' })
  })

  it('接受用户名或邮箱作为登录标识', () => {
    expect(
      loginSchema.parse({ identifier: 'alice', password: 'a password' })
    ).toEqual({ identifier: 'alice', password: 'a password' })
    expect(
      loginSchema.parse({
        identifier: 'alice@example.com',
        password: 'a password',
      })
    ).toEqual({ identifier: 'alice@example.com', password: 'a password' })
  })

  it('应用稳定的用户列表默认值', () => {
    expect(userListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 })
  })
})
