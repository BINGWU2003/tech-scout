import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/app.setup.js'
import { CatalogDatabase } from '../src/catalog/catalog.database.js'
import { PrismaService } from '../src/database/prisma.service.js'
import { resetCatalogFixture } from './catalog-fixture.js'

const runDatabaseTests = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_CATALOG_DATABASE_URL
)
const describeWithDatabase = runDatabaseTests ? describe : describe.skip

describeWithDatabase('Catalog 查询（端到端）', () => {
  let app: INestApplication
  let prisma: PrismaService

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.CATALOG_DATABASE_URL = process.env.TEST_CATALOG_DATABASE_URL
    process.env.WEB_ORIGIN = 'http://localhost:5173'
    process.env.SESSION_COOKIE_SECURE = 'false'
    await resetCatalogFixture(process.env.TEST_CATALOG_DATABASE_URL!)

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    configureApp(app)
    await app.init()
    prisma = app.get(PrismaService)
  })

  beforeEach(async () => {
    await prisma.userSession.deleteMany()
    await prisma.userAccount.deleteMany()
  })

  afterAll(async () => {
    if (app) await app.close()
  })

  it('允许已认证用户读取当前已发布版本', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'catalog_reader',
        email: 'reader@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const response = await agent
      .get('/api/v1/catalog/releases/current')
      .expect(200)

    expect(response.body).toMatchObject({
      releaseId: 'test-v1',
      dataset: 'ai-domains',
      periodFromYear: 2019,
      periodToYear: 2025,
    })
    expect(response.body).not.toHaveProperty('manifestPath')
  })

  it('按稳定顺序筛选并分页展示领域专利', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'patent_reader',
        email: 'patents@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const first = await agent
      .get('/api/v1/catalog/domains/ai_chips_edge_inference/patents')
      .query({
        title: 'neural',
        cpcPrefix: 'g06n3',
        partyName: 'acme',
        fromYear: 2024,
        page: 1,
        pageSize: 1,
      })
      .expect(200)

    expect(first.body).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
      items: [{ patentId: 'patent-1', totalScore: 8 }],
    })

    const second = await agent
      .get('/api/v1/catalog/domains/ai_chips_edge_inference/patents')
      .query({ page: 2, pageSize: 1 })
      .expect(200)
    expect(second.body.items[0].patentId).toBe('patent-2')

    const invalid = await agent
      .get('/api/v1/catalog/domains/ai_chips_edge_inference/patents')
      .query({ fromYear: 2025, toYear: 2020 })
      .expect(400)
    expect(invalid.body.code).toBe('VALIDATION_ERROR')
  })

  it('要求认证并列出当前领域', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/catalog/domains')
      .expect(401)

    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'domain_reader',
        email: 'domains@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const response = await agent.get('/api/v1/catalog/domains').expect(200)
    expect(response.body.items).toEqual([
      expect.objectContaining({
        domainId: 'ai_chips_edge_inference',
        patentCount: 2,
        companyCount: 1,
      }),
      expect.objectContaining({
        domainId: 'industrial_vision_quality_inspection',
        patentCount: 1,
        companyCount: 1,
      }),
    ])
  })

  it('返回专利分类、受让人、匹配原因和安全的来源信息', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'patent_detail_reader',
        email: 'patent-detail@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const response = await agent
      .get('/api/v1/catalog/patents/patent-1')
      .expect(200)

    expect(response.body.patent).toMatchObject({
      patentId: 'patent-1',
      classifications: [{ cpcGroup: 'G06N3/063' }],
      parties: [{ name: 'Acme AI, Inc.', role: 'assignee' }],
      domainMatches: [
        {
          domainId: 'ai_chips_edge_inference',
          totalScore: 8,
          matchedStrongKeywords: ['neural accelerator'],
        },
      ],
      source: {
        relativePath: 'patents/g_patent.tsv',
        sourceRowNumber: 10,
      },
    })
    expect(JSON.stringify(response.body)).not.toContain('D:/private')

    const missing = await agent
      .get('/api/v1/catalog/patents/missing-patent')
      .expect(404)
    expect(missing.body.code).toBe('PATENT_NOT_FOUND')
  })

  it('对领域公司排名，并通过别名或外部 ID 查找公司', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'company_reader',
        email: 'companies@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const ranking = await agent
      .get('/api/v1/catalog/domains/ai_chips_edge_inference/companies')
      .query({ page: 1, pageSize: 20 })
      .expect(200)
    expect(ranking.body).toMatchObject({
      total: 1,
      items: [{ companyId: 'company-1', patentCount: 2 }],
    })

    for (const query of [
      'Acme Artificial Intelligence',
      'TESTLEI000000000001',
    ]) {
      const search = await agent
        .get('/api/v1/catalog/companies')
        .query({ query })
        .expect(200)
      expect(
        search.body.items.map((item: { companyId: string }) => item.companyId)
      ).toEqual(['company-1'])
    }
  })

  it('返回公司身份、领域统计和已接受的匹配链', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'company_detail_reader',
        email: 'company-detail@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const response = await agent
      .get('/api/v1/catalog/companies/company-1')
      .expect(200)
    expect(response.body.company).toMatchObject({
      companyId: 'company-1',
      aliases: [{ name: 'Acme Artificial Intelligence' }],
      externalIdentifiers: [{ type: 'LEI', value: 'TESTLEI000000000001' }],
      relationships: [
        {
          direction: 'outgoing',
          relationshipType: 'IS_DIRECTLY_CONSOLIDATED_BY',
          relatedCompany: { companyId: 'company-2' },
        },
      ],
      domainStats: [{ domainId: 'ai_chips_edge_inference', patentCount: 2 }],
      acceptedMatches: [{ candidateId: 'candidate-1', decision: 'accepted' }],
    })
    expect(JSON.stringify(response.body)).not.toContain('D:/private')

    const missing = await agent
      .get('/api/v1/catalog/companies/missing-company')
      .expect(404)
    expect(missing.body.code).toBe('COMPANY_NOT_FOUND')
  })

  it('分页展示公司专利组合，并可按领域筛选', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'portfolio_reader',
        email: 'portfolio@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const response = await agent
      .get('/api/v1/catalog/companies/company-1/patents')
      .query({ domainId: 'ai_chips_edge_inference', page: 1, pageSize: 1 })
      .expect(200)

    expect(response.body).toMatchObject({
      total: 2,
      totalPages: 2,
      items: [{ patentId: 'patent-1' }],
    })
  })

  it('展示候选项最终决策和脱敏后的支持证据', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'evidence_reader',
        email: 'evidence@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const candidate = await agent
      .get('/api/v1/catalog/candidates/candidate-3')
      .expect(200)
    expect(candidate.body.candidate).toMatchObject({
      candidateId: 'candidate-3',
      decision: {
        value: 'rejected',
        organizationType: 'individual',
      },
      evidenceCount: 1,
    })

    const evidence = await agent
      .get('/api/v1/catalog/candidates/candidate-3/evidence')
      .expect(200)
    expect(evidence.body.items).toEqual([
      expect.objectContaining({
        evidenceId: 'evidence-2',
        source: expect.objectContaining({
          relativePath: 'reviews/test/evidence.jsonl',
        }),
      }),
    ])
    expect(JSON.stringify(evidence.body)).not.toContain('D:/private')
  })

  it('返回领域年度趋势和 CPC 分布', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'domain_detail_reader',
        email: 'domain-detail@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const response = await agent
      .get('/api/v1/catalog/domains/ai_chips_edge_inference')
      .expect(200)
    expect(response.body.domain).toMatchObject({
      patentCount: 2,
      companyCount: 1,
      yearTrend: [
        { year: 2024, patentCount: 1 },
        { year: 2025, patentCount: 1 },
      ],
      cpcGroups: [{ cpcGroup: 'G06N3/063', patentCount: 2 }],
    })
  })

  it('解析不透明定位符且不暴露服务器路径', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'source_reader',
        email: 'sources@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    const patent = await agent
      .get('/api/v1/catalog/patents/patent-1')
      .expect(200)
    const locator = patent.body.patent.source.locator
    const response = await agent
      .get(`/api/v1/catalog/sources/${encodeURIComponent(locator)}`)
      .expect(200)

    expect(response.body.source).toMatchObject({
      locator,
      dataset: 'patents',
      relativePath: 'patents/g_patent.tsv',
      sourceRowNumber: 10,
    })
    expect(JSON.stringify(response.body)).not.toContain('D:/private')
  })

  it('将运行时 Catalog 数据库故障映射为稳定的 503 响应', async () => {
    const agent = request.agent(app.getHttpServer())
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: 'outage_reader',
        email: 'outage@example.com',
        password: 'a secure catalog password',
      })
      .expect(201)

    await app.get(CatalogDatabase).destroy()

    const response = await agent
      .get('/api/v1/catalog/releases/current')
      .expect(503)
    expect(response.body).toMatchObject({
      code: 'CATALOG_UNAVAILABLE',
      message: 'Catalog 查询暂时不可用',
    })
  })
})

describeWithDatabase('Catalog 启动降级（端到端）', () => {
  it('在启动时无法连接 Catalog 的情况下保持账户 API 可用', async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    const unavailableUrl = new URL(process.env.TEST_CATALOG_DATABASE_URL!)
    unavailableUrl.hostname = '127.0.0.1'
    unavailableUrl.port = '1'
    unavailableUrl.searchParams.set('connect_timeout', '1')
    process.env.CATALOG_DATABASE_URL = unavailableUrl.toString()
    process.env.WEB_ORIGIN = 'http://localhost:5173'
    process.env.SESSION_COOKIE_SECURE = 'false'

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    const degradedApp = module.createNestApplication()
    configureApp(degradedApp)

    try {
      await degradedApp.init()
      const agent = request.agent(degradedApp.getHttpServer())
      await agent
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .send({
          username: 'degraded_reader',
          email: 'degraded@example.com',
          password: 'a secure catalog password',
        })
        .expect(201)

      const response = await agent
        .get('/api/v1/catalog/releases/current')
        .expect(503)
      expect(response.body.code).toBe('CATALOG_UNAVAILABLE')
    } finally {
      await degradedApp.close()
    }
  })
})
