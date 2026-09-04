import { describe, expect, it } from 'vitest'
import { apiErrorSchema, cursorPageQuerySchema } from './common.js'

describe('共享契约', () => {
  it('规范化默认分页大小', () => {
    expect(cursorPageQuerySchema.parse({})).toEqual({ limit: 20 })
  })

  it('拒绝不完整的 API 错误', () => {
    expect(() => apiErrorSchema.parse({ code: 'not_found' })).toThrow(
      /Invalid input/
    )
  })
})
