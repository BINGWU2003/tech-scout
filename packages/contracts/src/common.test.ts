import { describe, expect, it } from 'vitest'
import { apiErrorSchema, cursorPageQuerySchema } from './common.js'

describe('shared contracts', () => {
  it('normalizes the default page size', () => {
    expect(cursorPageQuerySchema.parse({})).toEqual({ limit: 20 })
  })

  it('rejects incomplete API errors', () => {
    expect(() => apiErrorSchema.parse({ code: 'not_found' })).toThrow(
      /Invalid input/
    )
  })
})
