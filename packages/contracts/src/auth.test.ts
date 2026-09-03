import { describe, expect, it } from 'vitest'
import {
  loginSchema,
  registerSchema,
  userListQuerySchema,
  usernameSchema,
} from './auth.js'

describe('auth contracts', () => {
  it('normalizes usernames and registration emails', () => {
    expect(usernameSchema.parse('  Alice_01 ')).toBe('alice_01')
    expect(
      registerSchema.parse({
        username: 'Alice_01',
        email: ' Alice@Example.COM ',
        password: 'correct horse battery staple',
      })
    ).toMatchObject({ username: 'alice_01', email: 'Alice@Example.COM' })
  })

  it('accepts either a username or email login identifier', () => {
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

  it('applies stable user list defaults', () => {
    expect(userListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 })
  })
})
