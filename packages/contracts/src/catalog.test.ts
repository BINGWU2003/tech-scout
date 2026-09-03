import { describe, expect, it } from 'vitest'
import {
  catalogDomainListSchema,
  catalogPatentListQuerySchema,
  catalogPatentListSchema,
  catalogPatentDetailResponseSchema,
  catalogCompanyListQuerySchema,
  catalogCompanyListSchema,
  catalogCompanyDetailResponseSchema,
  catalogCompanyPatentListQuerySchema,
  catalogCandidateDetailResponseSchema,
  catalogEvidenceListSchema,
  catalogDomainDetailResponseSchema,
  catalogSourceResponseSchema,
  catalogReleaseSchema,
  catalogPageQuerySchema,
} from './catalog.js'

describe('catalog contracts', () => {
  it('describes the current published release without exposing server paths', () => {
    const release = catalogReleaseSchema.parse({
      releaseId: '2026-09-v6',
      dataset: 'ai-domains',
      generatedAt: '2026-09-03T00:00:00.000Z',
      publishedAt: '2026-09-03T01:00:00.000Z',
      periodFromYear: 2019,
      periodToYear: 2025,
      unavailableFields: ['patent.abstract', 'patent.claims'],
    })

    expect(release).toEqual({
      releaseId: '2026-09-v6',
      dataset: 'ai-domains',
      generatedAt: '2026-09-03T00:00:00.000Z',
      publishedAt: '2026-09-03T01:00:00.000Z',
      periodFromYear: 2019,
      periodToYear: 2025,
      unavailableFields: ['patent.abstract', 'patent.claims'],
    })
    expect(release).not.toHaveProperty('manifestPath')
    expect(release).not.toHaveProperty('manifest')
  })

  it('uses the agreed page defaults and limit', () => {
    expect(catalogPageQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    })
    expect(() => catalogPageQuerySchema.parse({ pageSize: 101 })).toThrow(
      'Too big'
    )
  })

  it('returns domain summaries with current release context', () => {
    const result = catalogDomainListSchema.parse({
      release: {
        releaseId: '2026-09-v6',
        dataset: 'ai-domains',
        generatedAt: '2026-09-03T00:00:00.000Z',
        publishedAt: '2026-09-03T01:00:00.000Z',
        periodFromYear: 2019,
        periodToYear: 2025,
        unavailableFields: ['abstract'],
      },
      items: [
        {
          domainId: 'industrial_vision',
          name: '工业视觉 / AI 质检',
          ruleVersion: 'v1',
          definition: { includes: ['AOI'] },
          patentCount: 981,
          companyCount: 120,
        },
      ],
    })

    expect(result.items[0]).toMatchObject({
      domainId: 'industrial_vision',
      patentCount: 981,
      companyCount: 120,
    })
  })

  it('validates patent filters and a paged patent result', () => {
    const query = catalogPatentListQuerySchema.parse({
      title: 'neural accelerator',
      cpcPrefix: 'g06n3',
      partyName: 'Acme',
      fromYear: '2020',
      toYear: '2025',
    })
    expect(query).toMatchObject({
      page: 1,
      pageSize: 20,
      cpcPrefix: 'G06N3',
      sort: 'score',
      order: 'desc',
    })

    const result = catalogPatentListSchema.parse({
      release: {
        releaseId: '2026-09-v6',
        dataset: 'ai-domains',
        generatedAt: '2026-09-03T00:00:00.000Z',
        publishedAt: '2026-09-03T01:00:00.000Z',
        periodFromYear: 2019,
        periodToYear: 2025,
        unavailableFields: ['abstract'],
      },
      items: [
        {
          patentId: 'patent-1',
          title: 'Edge neural accelerator',
          patentDate: '2025-01-03',
          grantYear: 2025,
          patentType: 'utility',
          wipoKind: 'B2',
          numClaims: 20,
          withdrawn: false,
          totalScore: 8,
          cpcGroups: ['G06N3/063'],
          assignees: ['Acme AI, Inc.'],
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    })
    expect(result.items[0]?.patentId).toBe('patent-1')
  })

  it('describes patent evidence without an internal filesystem path', () => {
    const result = catalogPatentDetailResponseSchema.parse({
      release: {
        releaseId: '2026-09-v6',
        dataset: 'ai-domains',
        generatedAt: '2026-09-03T00:00:00.000Z',
        publishedAt: '2026-09-03T01:00:00.000Z',
        periodFromYear: 2019,
        periodToYear: 2025,
        unavailableFields: ['abstract'],
      },
      patent: {
        patentId: 'patent-1',
        title: 'Edge neural accelerator',
        patentDate: '2025-01-03',
        grantYear: 2025,
        patentType: 'utility',
        wipoKind: 'B2',
        numClaims: 20,
        withdrawn: false,
        classifications: [{ cpcGroup: 'G06N3/063', sequence: 1 }],
        parties: [
          {
            partyId: 'party-1',
            role: 'assignee',
            name: 'Acme AI, Inc.',
            country: 'US',
            sequence: 1,
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
            matchedGeneralKeywords: [],
          },
        ],
        source: {
          locator: 'opaque-locator',
          dataset: 'patents',
          relativePath: 'patents/g_patent.tsv',
          sourceRowNumber: 10,
          sha256: '1'.repeat(64),
          sourceRelease: 'source-v1',
          url: null,
        },
      },
    })

    expect(result.patent.source.relativePath).toBe('patents/g_patent.tsv')
    expect(result.patent.source).not.toHaveProperty('sourcePath')
  })

  it('validates company search and deterministic ranking results', () => {
    expect(
      catalogCompanyListQuerySchema.parse({
        query: 'Acme',
        country: 'us',
        sort: 'latestPatentDate',
        order: 'asc',
      })
    ).toEqual({
      page: 1,
      pageSize: 20,
      query: 'Acme',
      country: 'US',
      sort: 'latestPatentDate',
      order: 'asc',
    })

    const result = catalogCompanyListSchema.parse({
      release: {
        releaseId: '2026-09-v6',
        dataset: 'ai-domains',
        generatedAt: '2026-09-03T00:00:00.000Z',
        publishedAt: '2026-09-03T01:00:00.000Z',
        periodFromYear: 2019,
        periodToYear: 2025,
        unavailableFields: [],
      },
      items: [
        {
          companyId: 'company-1',
          preferredName: 'Acme AI',
          legalName: 'Acme AI, Inc.',
          country: 'US',
          provider: 'GLEIF',
          entityStatus: 'ACTIVE',
          patentCount: 2,
          latestPatentDate: '2025-01-03',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    })
    expect(result.items[0]?.preferredName).toBe('Acme AI')
  })

  it('describes company identity, relationships and accepted match chains', () => {
    const result = catalogCompanyDetailResponseSchema.parse({
      release: {
        releaseId: 'test-v1',
        dataset: 'ai-domains',
        generatedAt: '2026-09-01T00:00:00.000Z',
        publishedAt: '2026-09-01T01:00:00.000Z',
        periodFromYear: 2019,
        periodToYear: 2025,
        unavailableFields: [],
      },
      company: {
        companyId: 'company-1',
        preferredName: 'Acme AI',
        legalName: 'Acme AI, Inc.',
        country: 'US',
        provider: 'GLEIF',
        entityStatus: 'ACTIVE',
        aliases: [
          {
            aliasId: 'alias-1',
            name: 'Acme Artificial Intelligence',
            type: 'other',
            provider: 'GLEIF',
          },
        ],
        externalIdentifiers: [
          {
            identifierId: 'identifier-1',
            type: 'LEI',
            value: 'TESTLEI000000000001',
            provider: 'GLEIF',
          },
        ],
        relationships: [],
        domainStats: [
          {
            domainId: 'ai_chips_edge_inference',
            domainName: 'AI chips and edge inference',
            patentCount: 2,
            latestPatentDate: '2025-01-03',
          },
        ],
        acceptedMatches: [
          {
            candidateId: 'candidate-1',
            representativeName: 'Acme AI, Inc.',
            country: 'US',
            patentCount: 2,
            matchMethod: 'unique_legal_name',
            similarityScore: 0.99,
            decision: 'accepted',
            decisionReason: 'Legal name and country matched',
            ruleVersion: 'rules-v1',
          },
        ],
        source: {
          locator: 'opaque',
          dataset: 'companies',
          relativePath: 'companies/gleif.csv',
          sourceRowNumber: 40,
          sha256: '4'.repeat(64),
          sourceRelease: 'source-v1',
          url: null,
        },
      },
    })

    expect(result.company.acceptedMatches[0]?.candidateId).toBe('candidate-1')
  })

  it('allows company patents to be narrowed to one domain', () => {
    expect(
      catalogCompanyPatentListQuerySchema.parse({
        domainId: 'ai_chips_edge_inference',
        page: '2',
      })
    ).toMatchObject({
      domainId: 'ai_chips_edge_inference',
      page: 2,
      pageSize: 20,
    })
  })

  it('keeps terminal candidate decisions and evidence auditable', () => {
    const release = {
      releaseId: 'test-v1',
      dataset: 'ai-domains',
      generatedAt: '2026-09-01T00:00:00.000Z',
      publishedAt: '2026-09-01T01:00:00.000Z',
      periodFromYear: 2019,
      periodToYear: 2025,
      unavailableFields: [],
    }
    const detail = catalogCandidateDetailResponseSchema.parse({
      release,
      candidate: {
        candidateId: 'candidate-3',
        representativeName: 'Individual Inventor',
        country: 'US',
        patentCount: 1,
        partyRowCount: 1,
        rawNameVariantCount: 1,
        decision: {
          value: 'rejected',
          organizationType: 'individual',
          selectedCompanyId: null,
          reviewMethod: 'evidence_rule',
          reviewedAt: '2026-08-30T00:00:00.000Z',
          reviewer: 'fixture',
          note: 'Confirmed as individual',
        },
        suggestions: [
          {
            matchId: 'entity-match-3',
            suggestedCompanyId: 'company-1',
            suggestedName: 'Acme AI',
            provider: 'GLEIF',
            matchMethod: 'name_similarity',
            similarityScore: 0.4,
            decision: 'rejected',
            decisionReason: 'Entity is an individual',
            accepted: false,
          },
        ],
        evidenceCount: 1,
      },
    })
    expect(detail.candidate.decision?.value).toBe('rejected')

    const evidence = catalogEvidenceListSchema.parse({
      release,
      items: [
        {
          evidenceId: 'evidence-2',
          candidateId: 'candidate-3',
          publisher: 'USPTO',
          sourceType: 'official_record',
          sourceUrl: 'https://example.test/individual',
          observedAt: '2026-08-30T00:00:00.000Z',
          legalName: null,
          country: 'US',
          identifierType: null,
          identifierValue: null,
          preserved: false,
          contentSha256: null,
          source: {
            locator: 'opaque',
            dataset: 'entity-evidence',
            relativePath: 'reviews/test/evidence.jsonl',
            sourceRowNumber: 71,
            sha256: '7'.repeat(64),
            sourceRelease: 'review-v1',
            url: 'https://example.test/individual',
          },
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    })
    expect(evidence.items[0]?.source.relativePath).not.toContain('D:')
  })

  it('describes domain trends and CPC distribution', () => {
    const result = catalogDomainDetailResponseSchema.parse({
      release: {
        releaseId: 'test-v1',
        dataset: 'ai-domains',
        generatedAt: '2026-09-01T00:00:00.000Z',
        publishedAt: '2026-09-01T01:00:00.000Z',
        periodFromYear: 2019,
        periodToYear: 2025,
        unavailableFields: [],
      },
      domain: {
        domainId: 'ai_chips_edge_inference',
        name: 'AI chips and edge inference',
        ruleVersion: 'rules-v1',
        definition: {},
        patentCount: 2,
        companyCount: 1,
        yearTrend: [
          { year: 2024, patentCount: 1 },
          { year: 2025, patentCount: 1 },
        ],
        cpcGroups: [{ cpcGroup: 'G06N3/063', patentCount: 2 }],
      },
    })
    expect(result.domain.cpcGroups[0]?.patentCount).toBe(2)
  })

  it('resolves an opaque source locator to sanitized metadata', () => {
    const result = catalogSourceResponseSchema.parse({
      release: {
        releaseId: 'test-v1',
        dataset: 'ai-domains',
        generatedAt: '2026-09-01T00:00:00.000Z',
        publishedAt: '2026-09-01T01:00:00.000Z',
        periodFromYear: 2019,
        periodToYear: 2025,
        unavailableFields: [],
      },
      source: {
        locator: 'opaque',
        dataset: 'patents',
        relativePath: 'patents/g_patent.tsv',
        sourceRowNumber: 10,
        sha256: '1'.repeat(64),
        sourceRelease: 'source-v1',
        url: null,
      },
    })
    expect(result.source.relativePath).toBe('patents/g_patent.tsv')
  })
})
