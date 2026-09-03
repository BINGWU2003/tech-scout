import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { CatalogPatentDetail } from './catalog-patent-detail'

const patent = {
  patentId: 'patent-1',
  title: 'Edge neural accelerator',
  patentDate: '2025-01-03',
  grantYear: 2025,
  patentType: 'utility',
  wipoKind: 'B2',
  numClaims: 20,
  withdrawn: false,
  classifications: [
    {
      cpcGroup: 'G06N3/063',
      sequence: 0,
      type: 'primary',
      actionDate: '2025-01-03',
    },
  ],
  parties: [
    {
      partyId: 'party-1',
      role: 'assignee',
      name: 'Acme AI, Inc.',
      country: 'US',
      city: 'Austin',
      region: 'TX',
      sequence: 0,
      isIndividual: false,
    },
  ],
  domainMatches: [
    {
      domainId: 'ai_chips_edge_inference',
      domainName: 'AI chips and edge inference',
      totalScore: 8,
      ruleVersion: 'rules-v1',
      matchedCpcs: ['G06N3/063'],
      matchedStrongKeywords: ['neural accelerator'],
      matchedGeneralKeywords: ['edge'],
    },
  ],
  source: {
    locator: 'patent-source',
    dataset: 'patents',
    relativePath: 'patents/g_patent.tsv',
    sourceRowNumber: 10,
    sha256: 'a'.repeat(64),
    sourceRelease: 'patents-v1',
    url: 'https://example.com/patents/patent-1',
  },
}

describe('CatalogPatentDetail', () => {
  it('shows classifications, parties, matching reasons and traceable source', async () => {
    const screen = await render(<CatalogPatentDetail patent={patent} />)

    await expect
      .element(screen.getByText('G06N3/063').first())
      .toBeInTheDocument()
    await expect.element(screen.getByText('Acme AI, Inc.')).toBeInTheDocument()
    await expect
      .element(screen.getByText('neural accelerator'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: '查看原始来源' }))
      .toHaveAttribute('href', 'https://example.com/patents/patent-1')
    await expect
      .element(screen.getByText(/patents\/g_patent\.tsv.*10/))
      .toBeInTheDocument()
  })
})
