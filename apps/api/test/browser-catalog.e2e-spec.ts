import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as c from '@tech-scout/contracts'
import { Client } from 'pg'
import { BrowserCatalogRepository } from '../src/catalog/browser-catalog.repository.js'
import { CatalogDatabase } from '../src/catalog/catalog.database.js'

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  '浏览器目录：真实数据库投影',
  () => {
    let database: CatalogDatabase,
      repository: BrowserCatalogRepository,
      client: Client
    const run = randomUUID(),
      co = randomUUID(),
      candidate = randomUUID()
    const source = {
      source_path: 'browser/test.html',
      source_sha256: 'a'.repeat(64),
      source_row_number: null,
      source_url: 'https://patents.google.com/patent/CN123A/zh',
      source_release: run,
    }
    beforeAll(async () => {
      const dsn = process.env.TEST_DATABASE_URL!
      if (!new URL(dsn).pathname.endsWith('_test'))
        throw new Error('需要独立测试库')
      client = new Client({ connectionString: dsn })
      await client.connect()
      await client.query(
        await readFile(
          new URL(
            '../../../services/acquisition/src/tech_scout_acquisition/schema.sql',
            import.meta.url
          ),
          'utf8'
        )
      )
      process.env.CATALOG_DATABASE_URL = dsn
      database = new CatalogDatabase()
      repository = new BrowserCatalogRepository(database)
    })
    afterAll(async () => {
      await database?.destroy()
      await client?.end()
    })
    it('空库提示创建研究，不要求导入旧目录', async () => {
      await expect(repository.currentRelease()).rejects.toMatchObject({
        response: { code: 'CATALOG_UNAVAILABLE' },
      })
    })
    it('新快照保留公开年份、正文和企业资料，所有读取符合契约', async () => {
      const snapshot = {
        release: {
          release_id: run,
          dataset: 'google-patents-riskbird',
          published_at: '2026-09-07T00:00:00+00:00',
          period_from_year: 2016,
          period_to_year: 2026,
        },
        domains: [
          {
            domain_id: 'battery',
            name: '固态电池',
            rule_version: 'browser-v1',
            definition: {},
          },
        ],
        patents: [
          {
            patent_id: 'CN123A',
            patent_title: '固态电池',
            patent_date: '2025-01-02',
            publication_year: 2025,
            grant_year: null,
            abstract: '真实字段夹具',
            claims: '权利要求',
            ...source,
          },
        ],
        'patent-domain-matches': [
          { domain_id: 'battery', patent_id: 'CN123A' },
        ],
        'patent-classifications': [{ patent_id: 'CN123A', cpc_group: 'H01M' }],
        'patent-parties': [
          {
            patent_id: 'CN123A',
            patent_party_id: 'p1',
            party_role: 'assignee',
            party_name: '某公司',
            country: null,
          },
        ],
        companies: [
          {
            company_id: co,
            preferred_name: '某公司',
            legal_name: '某公司',
            country: 'CN',
            business_info: { 经营状态: '在营' },
            ...source,
          },
        ],
        'company-patent-relations': [{ company_id: co, patent_id: 'CN123A' }],
        'company-candidates': [
          {
            candidate_id: candidate,
            representative_name: '某公司',
            country: null,
            patent_count: 1,
          },
        ],
        'company-aliases': [],
        'external-identifiers': [],
        'entity-evidence': [],
        'entity-matches': [],
      }
      await client.query(
        'INSERT INTO ingestion.job(run_id,plan) VALUES($1,$2)',
        [run, {}]
      )
      await client.query(
        'INSERT INTO catalog_v2.release(release_id,snapshot) VALUES($1,$2)',
        [run, snapshot]
      )
      const detail = c.catalogPatentDetailResponseSchema.parse(
        await repository.patentDetail('CN123A')
      )
      expect(detail.patent).toMatchObject({
        publicationYear: 2025,
        grantYear: null,
        abstract: '真实字段夹具',
        source: { sourceRowNumber: null },
      })
      c.catalogDomainListSchema.parse(await repository.listDomains())
      c.catalogDomainDetailResponseSchema.parse(
        await repository.domainDetail('battery')
      )
      const q = c.catalogPatentListQuerySchema.parse({})
      c.catalogPatentListSchema.parse(
        await repository.listDomainPatents('battery', q)
      )
      c.catalogPatentListSchema.parse(
        await repository.listCompanyPatents(co, q)
      )
      const cq = c.catalogCompanyListQuerySchema.parse({})
      c.catalogCompanyListSchema.parse(await repository.listCompanies(cq))
      c.catalogCompanyListSchema.parse(
        await repository.listDomainCompanies('battery', cq)
      )
      expect(
        c.catalogCompanyDetailResponseSchema.parse(
          await repository.companyDetail(co)
        ).company.businessInfo
      ).toEqual({ 经营状态: '在营' })
      c.catalogCandidateDetailResponseSchema.parse(
        await repository.candidateDetail(candidate)
      )
      c.catalogEvidenceListSchema.parse(
        await repository.candidateEvidence(
          candidate,
          c.catalogPageQuerySchema.parse({})
        )
      )
      c.catalogSourceResponseSchema.parse(
        await repository.sourceDetail(detail.patent.source.locator)
      )
    })
  }
)
