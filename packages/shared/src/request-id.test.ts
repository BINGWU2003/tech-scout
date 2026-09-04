import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestId } from './index.js'

describe('createRequestId 请求标识生成', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('优先使用原生 randomUUID', () => {
    const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000')
    vi.stubGlobal('crypto', { randomUUID })

    expect(createRequestId()).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('在 randomUUID 不可用时通过 getRandomValues 生成 UUID v4', () => {
    const getRandomValues = vi.fn((target: Uint8Array) => {
      target.set([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
        0x0c, 0x0d, 0x0e, 0x0f,
      ])
      return target
    })
    vi.stubGlobal('crypto', { getRandomValues })

    expect(createRequestId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('在 Web Crypto 不可用时生成非安全的 UUID v4 请求标识', () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    expect(createRequestId()).toBe('80808080-8080-4080-8080-808080808080')
  })
})
