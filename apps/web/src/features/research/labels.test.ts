import { describe, expect, it } from 'vitest'
import { candidateCountryLabel } from './labels'

describe('待核对主体注册地文案', () => {
  it('区分已确认、候选建议和尚未核验', () => {
    expect(
      [
        {
          country: 'CN',
          countryStatus: 'verified' as const,
          countrySource: 'patent',
        },
        {
          country: 'CN',
          countryStatus: 'suggested' as const,
          countrySource: 'tianyancha',
        },
        {
          country: null,
          countryStatus: 'unknown' as const,
          countrySource: null,
        },
      ].map(candidateCountryLabel)
    ).toEqual([
      '企业注册地：中国（已确认）',
      '候选企业注册地：中国（天眼查，待确认）',
      '申请人注册地尚未核验',
    ])
  })
})
