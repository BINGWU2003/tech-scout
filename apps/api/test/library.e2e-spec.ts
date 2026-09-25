import { randomUUID } from 'node:crypto'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { libraryListSchema, libraryDetailSchema } from '@tech-scout/contracts'
import { Pool } from 'pg'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/app.setup.js'
import { CatalogPrismaService } from '../src/database/catalog-prisma.service.js'
import { LibraryRepository } from '../src/library/library.repository.js'

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip
suite('累计数据库（端到端）', () => {
  let app: INestApplication, pool: Pool
  const first = randomUUID(),
    second = randomUUID(),
    patent = 'CNTEST' + randomUUID().replaceAll('-', ''),
    other = patent + 'B'
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.WEB_ORIGIN = 'http://localhost:5173'
    process.env.SESSION_COOKIE_SECURE = 'false'
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
    for (const [id, status] of [
      [first, 'completed'],
      [second, 'paused'],
    ]) {
      await pool.query(
        'INSERT INTO ingestion.job(run_id,plan,status) VALUES($1,$2,$3)',
        [
          id,
          { directions: [{ domain_id: 'test', name: '累计检索验收' }] },
          status,
        ]
      )
    }
    for (const id of [patent, other])
      await pool.query('INSERT INTO catalog_v2.patent VALUES($1,$2,now())', [
        id,
        {
          title: '累计检索验收',
          publication_date: '2025-01-01',
          abstract: '详情摘要',
          claims: '正文不能进入列表',
          raw_html: 'LARGE_PRIVATE_HTML'.repeat(100000),
          current_assignees: ['公司甲'],
          original_assignees: ['公司乙'],
        },
      ])
    for (const [id, run] of [
      [patent, first],
      [patent, second],
      [other, second],
    ])
      await pool.query(
        'INSERT INTO catalog_v2.record_source VALUES($1,$2,$3,$4)',
        [
          'patent',
          id,
          run,
          {
            domain_ids: ['test'],
            source_url: 'https://patents.google.com/patent/' + id + '/zh',
            observed_at: '2026-09-08T00:00:00Z',
          },
        ]
      )
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = module.createNestApplication()
    configureApp(app)
    await app.init()
  })
  afterAll(async () => {
    await app?.close()
    await pool?.end()
  })
  async function login() {
    const agent = request.agent(app.getHttpServer()),
      username = 'lib_' + randomUUID().slice(0, 8)
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username,
        email: username + '@example.com',
        password: 'library regression password',
      })
      .expect(201)
    return agent
  }
  it('要求登录并移除旧目录入口', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/library/patents')
      .expect(401)
    await request(app.getHttpServer())
      .get('/api/v1/catalog/releases/current')
      .expect(404)
  })
  it('累计、去重、分页与研究筛选，空结果返回成功', async () => {
    const a = await login()
    const all = await a
      .get('/api/v1/library/patents')
      .query({ query: patent, pageSize: 1 })
      .expect(200)
    const parsed = libraryListSchema.parse(all.body)
    expect(parsed.total).toBe(2)
    expect(parsed.items).toHaveLength(1)
    expect(all.body).not.toHaveProperty('release')
    const only = await a
      .get('/api/v1/library/patents')
      .query({ runId: first })
      .expect(200)
    expect(only.body.items.map((r: { id: string }) => r.id)).toEqual([patent])
    expect(only.body.items[0].sources).toHaveLength(2)
    expect(
      only.body.items[0].sources.map((r: { status: string }) => r.status)
    ).toContain('paused')
    expect(only.body.items[0]).not.toHaveProperty('claims')
    const empty = await a
      .get('/api/v1/library/patents')
      .query({ runId: randomUUID() })
      .expect(200)
    expect(empty.body.items).toEqual([])
    expect(empty.body.total).toBe(0)
    await a.get('/api/v1/library/patents').query({ runId: 'bad' }).expect(400)
  })
  it('详情分开显示申请人与当前权利人并保留网页来源', async () => {
    const a = await login(),
      res = await a.get('/api/v1/library/patents/' + patent).expect(200)
    const d = libraryDetailSchema.parse(res.body)
    expect(d.currentAssignees).toEqual(['公司甲'])
    expect(d.originalAssignees).toEqual(['公司乙'])
    expect(d.claims).toBe('正文不能进入列表')
    expect(d.sources[0]).not.toHaveProperty('sourceRowNumber')
    await a.get('/api/v1/library/patents/missing').expect(404)
  })
  it('资料库运行时连接只读，超时配置保留', async () => {
    const catalog = app.get(CatalogPrismaService)
    const runId = randomUUID()
    await expect(
      catalog.ingestionJob.create({
        data: { runId, plan: {} },
      })
    ).rejects.toThrow()
    expect(
      (
        await pool.query('SELECT run_id FROM ingestion.job WHERE run_id=$1', [
          runId,
        ])
      ).rowCount
    ).toBe(0)
    expect(await catalog.$queryRaw`SHOW default_transaction_read_only`).toEqual(
      [{ default_transaction_read_only: 'on' }]
    )
    expect(await catalog.$queryRaw`SHOW statement_timeout`).toEqual([
      { statement_timeout: '10s' },
    ])
  })

  it('数据库返回阶段已裁剪正文，列表查询次数不随记录数增长', async () => {
    const catalog = app.get(CatalogPrismaService)
    const repository = app.get(LibraryRepository)
    const spy = vi.spyOn(catalog, '$queryRaw')
    try {
      for (const pageSize of [1, 10]) {
        spy.mockClear()
        await repository.list('patent', { query: patent, page: 1, pageSize })
        expect(spy).toHaveBeenCalledTimes(2)
        const databaseResults = await Promise.all(
          spy.mock.results.map((result) => result.value)
        )
        const serialized = JSON.stringify(databaseResults)
        expect(serialized).not.toContain('LARGE_PRIVATE_HTML')
        expect(serialized).not.toContain('正文不能进入列表')
        expect(serialized.length).toBeLessThan(10000)
      }
    } finally {
      spy.mockRestore()
    }
    const runs = await repository.runs()
    expect(runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: first, directions: ['累计检索验收'] }),
      ])
    )
    expect(
      (
        await repository.list('patent', {
          query: "' OR 1=1 --",
          page: 1,
          pageSize: 10,
        })
      ).total
    ).toBe(0)
  })
})
