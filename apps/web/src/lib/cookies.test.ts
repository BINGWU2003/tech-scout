import { beforeEach, describe, expect, it } from 'vitest'
import { clearCookies } from '@/test-utils/cookies'
import { getCookie, removeCookie, setCookie } from './cookies'

const COOKIE_PREFIX = 'test_cookie_'

describe('Cookie 操作', () => {
  const uniqueName = () =>
    `${COOKIE_PREFIX}${Math.random().toString(36).slice(2)}`

  beforeEach(() => {
    clearCookies(COOKIE_PREFIX)
  })

  it('存储一个可被读回的值', () => {
    const name = uniqueName()
    const value = 'hello-world'

    setCookie(name, value)

    expect(getCookie(name)).toBe(value)
  })

  it('清除值使其无法再被读取', () => {
    const name = uniqueName()

    setCookie(name, 'x')
    expect(getCookie(name)).toBe('x')

    removeCookie(name)

    expect(getCookie(name)).toBeUndefined()
  })
})
