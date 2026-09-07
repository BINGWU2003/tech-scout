import { randomUUID } from 'node:crypto'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { type ResearchState } from '@tech-scout/contracts'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/app.setup.js'
import { PrismaService } from '../src/database/prisma.service.js'
import { Prisma } from '../src/generated/prisma/client.js'
import { IntelligenceClient } from '../src/research/intelligence.client.js'

const enabled = Boolean(process.env.TEST_DATABASE_URL)
const plan = {
  from_year: 2019,
  to_year: 2025,
  risks: ['只有标题'],
  directions: [
    {
      domain_id: 'vision',
      name: '视觉',
      keywords: ['vision'],
      excluded_keywords: [],
      cpc_prefixes: [],
      explanation: '标题相关',
    },
  ],
}
const source = {
  source_path: 'silver/patents.csv',
  source_sha256: 'a'.repeat(64),
  source_row_number: 3,
}
const patent = {
  patent_id: 'p1',
  patent_title: 'Vision inspection',
  grant_year: 2025,
  cpcs: ['G06V'],
  matches: [{ domain_id: 'vision' }],
  ...source,
}
const company = {
  company_id: 'c1',
  preferred_name: 'Acme',
  legal_name: 'Acme',
  country: 'US',
  identity: 'catalog_verified',
  patent_ids: ['p1'],
  patent_count: 1,
  grant_year_trend: { '2025': 1 },
  rule_score: 8,
  latest_grant_year: 2025,
  inference: { summary: '仅为技术相关性推断', patent_ids: ['p1'] },
  relations: [
    {
      candidate_id: 'u1',
      patent_id: 'p1',
      match_method: 'exact',
      entity_match_decision: 'accepted',
    },
  ],
  ...source,
}
const candidate = {
  candidate_id: 'u1',
  name: 'Acme candidate',
  status: 'unverified',
  country: 'US',
  requires_confirmation: true,
  terminal_exclusion: false,
  patent_ids: ['p1'],
}
const evidence = {
  evidence_id: 'e1',
  candidate_id: 'u1',
  legal_name: 'Acme',
  country: 'US',
  publisher: 'Registry',
  preserved: true,
  ...source,
}

describe.skipIf(!enabled)(
  '研究页面投影：真实 PostgreSQL、鉴权和轻量事件',
  () => {
    let app: INestApplication, prisma: PrismaService
    let owner: ReturnType<typeof request.agent>,
      stranger: ReturnType<typeof request.agent>
    let id: string,
      queuedId: string,
      csrf: string,
      strangerCsrf: string,
      cookie: string
    const users: string[] = []
    let state: ResearchState

    beforeAll(async () => {
      const url = new URL(process.env.TEST_DATABASE_URL!)
      if (!url.pathname.endsWith('_test')) throw new Error('必须使用独立测试库')
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
      process.env.CATALOG_DATABASE_URL = process.env.TEST_DATABASE_URL
      process.env.WEB_ORIGIN = 'http://localhost:5173'
      process.env.SESSION_COOKIE_SECURE = 'false'
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IntelligenceClient)
        .useValue({
          configured: false,
          start: async (runId: string) => ({
            ...state,
            run_id: runId,
            status: 'awaiting_plan',
            sequence: 1,
          }),
          events: async () => [],
          action: async (runId: string) => ({
            ...state,
            run_id: runId,
            status: 'cancelled',
            sequence: 3,
          }),
          async *stream() {
            /* This test never calls a model. */
          },
        })
        .compile()
      app = module.createNestApplication()
      configureApp(app)
      await app.init()
      prisma = app.get(PrismaService)
      owner = request.agent(app.getHttpServer())
      stranger = request.agent(app.getHttpServer())
      for (const agent of [owner, stranger]) {
        const name = 'view_' + randomUUID().slice(0, 8)
        const reg = await agent
          .post('/api/v1/auth/register')
          .set('Origin', 'http://localhost:5173')
          .send({
            username: name,
            email: name + '@example.com',
            password: 'isolated view test password',
          })
          .expect(201)
        users.push(reg.body.user.id)
        if (agent === owner) {
          csrf = reg.body.csrfToken
          cookie = (reg.headers['set-cookie'] as unknown as string[])
            .map((c) => c.split(';')[0])
            .join('; ')
        } else strangerCsrf = reg.body.csrfToken
      }
      id = randomUUID()
      queuedId = randomUUID()
      state = {
        run_id: id,
        status: 'completed',
        sequence: 2,
        node: 'finish',
        error: null,
        budget: {
          requests: 2,
          reserved_cny: 0.2,
          estimated_cny: 0.05,
          elapsed_seconds: 40,
          input_tokens: 1000,
          output_tokens: 100,
          max_requests: 6,
          max_cny: 1,
          max_seconds: 300,
        },
        artifacts: {
          plan,
          confirmed_plan: plan,
          context: {
            release: {
              release_id: 'saved-v1',
              period_from_year: 2019,
              period_to_year: 2025,
            },
            domains: [{ domain_id: 'vision', name: '视觉' }],
          },
          patents: [patent],
          companies: [company],
          unverified: [candidate],
          snapshot: {
            patents: [patent],
            companies: [
              company,
              { company_id: 'c2', preferred_name: 'Different', country: 'US' },
            ],
            'entity-evidence': [evidence],
            'external-identifiers': [],
            'company-aliases': [],
          },
          raw_private_material: 'NEVER_SEND'.repeat(100000),
          result: {
            release_id: 'saved-v1',
            patent_count: 1,
            companies: [company],
            missing: ['正文'],
            unverified: [candidate],
            conflicts: [],
            empty_reason: null,
          },
        },
      }
      await prisma.researchProject.create({
        data: {
          userId: users[0],
          title: '隔离测试',
          question: '视觉',
          requestKey: randomUUID(),
          runs: {
            create: [
              {
                id,
                requestKey: randomUUID(),
                question: '视觉',
                status: 'completed',
                sequence: 2,
                state: state as unknown as Prisma.InputJsonValue,
              },
              {
                id: queuedId,
                requestKey: randomUUID(),
                question: '等待服务',
                status: 'queued',
                state: {},
              },
            ],
          },
        },
      })
      for (const sequence of [1, 2])
        await prisma.researchEvent.create({
          data: {
            runId: id,
            sequence,
            kind: sequence === 2 ? 'completed' : 'node_started',
            createdAt: new Date(),
            data: { ...state, sequence } as unknown as Prisma.InputJsonValue,
          },
        })
    }, 30000)

    afterAll(async () => {
      if (prisma)
        await prisma.userAccount.deleteMany({ where: { id: { in: users } } })
      await app?.close()
    })

    it('摘要与事件剥离大材料，保持数据版本与完整计划；排队态正常', async () => {
      const summary = await owner
        .get(`/api/v1/research/ui/runs/${id}`)
        .expect(200)
      expect(summary.body).toMatchObject({
        ready: true,
        releaseId: 'saved-v1',
        plan,
        confirmedPlan: plan,
        hasResult: true,
        pendingCandidateIds: ['u1'],
      })
      expect(JSON.stringify(summary.body).length).toBeLessThan(5000)
      expect(JSON.stringify(summary.body)).not.toContain('NEVER_SEND')
      const events = await owner
        .get(`/api/v1/research/ui/runs/${id}/events?after=1`)
        .expect(200)
      expect(events.body.map((e: { sequence: number }) => e.sequence)).toEqual([
        2,
      ])
      expect(JSON.stringify(events.body).length).toBeLessThan(1000)
      const queued = await owner
        .get(`/api/v1/research/ui/runs/${queuedId}`)
        .expect(200)
      expect(queued.body).toMatchObject({
        ready: false,
        budget: null,
        plan: null,
        status: 'queued',
      })
    })

    it('结果、专利分页和身份材料只读取本轮快照，支持依据匹配且不泄漏原始记录', async () => {
      const result = await owner
        .get(`/api/v1/research/ui/runs/${id}/result`)
        .expect(200)
      expect(result.body.companies[0]).toMatchObject({
        id: 'c1',
        patentCount: 1,
        citationIds: ['p1'],
      })
      expect(result.body.companies[0]).not.toHaveProperty('relations')
      const patents = await owner
        .get(
          `/api/v1/research/ui/runs/${id}/patents?companyId=c1&patentId=p1&pageSize=1`
        )
        .expect(200)
      expect(patents.body.items[0]).toMatchObject({
        id: 'p1',
        title: 'Vision inspection',
        source: { path: 'silver/patents.csv' },
      })
      expect(
        (
          await owner
            .get(`/api/v1/research/ui/runs/${id}/patents?page=2`)
            .expect(200)
        ).body.items
      ).toEqual([])
      const candidates = await owner
        .get(`/api/v1/research/ui/runs/${id}/candidates?pending=true`)
        .expect(200)
      expect(candidates.body.total).toBe(1)
      const detail = await owner
        .get(`/api/v1/research/ui/runs/${id}/candidates/u1`)
        .expect(200)
      expect(detail.body.companyOptions).toEqual([
        {
          id: 'c1',
          name: 'Acme',
          country: 'US',
          supportingEvidenceIds: ['e1'],
        },
        {
          id: 'c2',
          name: 'Different',
          country: 'US',
          supportingEvidenceIds: [],
        },
      ])
      const companyResult = await owner
        .get(`/api/v1/research/ui/runs/${id}/companies/c1`)
        .expect(200)
      expect(companyResult.body.evidence[0].id).toBe('e1')
      expect(JSON.stringify(companyResult.body)).not.toContain('NEVER_SEND')
    })

    it('全部读取路径校验所有权；写入校验 CSRF；非法游标与分页返回 400', async () => {
      for (const suffix of [
        '',
        '/result',
        '/conflicts',
        '/patents',
        '/candidates',
        '/candidates/u1',
        '/companies/c1',
        '/events',
        '/stream',
      ]) {
        await stranger
          .get(`/api/v1/research/ui/runs/${id}${suffix}`)
          .expect(404)
        await request(app.getHttpServer())
          .get(`/api/v1/research/ui/runs/${id}${suffix}`)
          .expect(401)
      }
      await owner
        .get(`/api/v1/research/ui/runs/${id}/patents?page=0`)
        .expect(400)
      await owner
        .get(`/api/v1/research/ui/runs/${id}/stream`)
        .set('Last-Event-ID', 'oops')
        .expect(400)
      await owner
        .post(`/api/v1/research/ui/runs/${id}/actions`)
        .set('Origin', 'http://localhost:5173')
        .send({ action_id: randomUUID(), kind: 'cancel' })
        .expect(401)
      await stranger
        .post(`/api/v1/research/ui/runs/${id}/actions`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', csrf)
        .send({ action_id: randomUUID(), kind: 'cancel' })
        .expect(401)
    })

    it('轻量 SSE 按 Last-Event-ID 恢复，关闭客户端后释放流', async () => {
      await app.listen(0, '127.0.0.1')
      const abort = new AbortController()
      const response = await fetch(
        `${await app.getUrl()}/api/v1/research/ui/runs/${id}/stream`,
        {
          headers: { Cookie: cookie, 'Last-Event-ID': '1' },
          signal: abort.signal,
        }
      )
      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      try {
        const data = new TextDecoder().decode((await reader.read()).value)
        expect(data).toContain('id: 2\n')
        expect(data).not.toContain('NEVER_SEND')
        expect(data.length).toBeLessThan(1000)
      } finally {
        abort.abort()
        await reader.cancel().catch(() => undefined)
      }
    })

    it('轻量写入返回摘要，原有所有权、幂等动作和新轮次逻辑仍生效', async () => {
      const action = { action_id: randomUUID(), kind: 'cancel' }
      await stranger
        .post(`/api/v1/research/ui/runs/${id}/actions`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', strangerCsrf)
        .send(action)
        .expect(404)
      const response = await owner
        .post(`/api/v1/research/ui/runs/${id}/actions`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', csrf)
        .send(action)
        .expect(201)
      expect(response.body.status).toBe('cancelled')
      expect(JSON.stringify(response.body).length).toBeLessThan(5000)
      const repeated = await owner
        .post(`/api/v1/research/ui/runs/${id}/actions`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', csrf)
        .send(action)
        .expect(201)
      expect(repeated.body.sequence).toBe(response.body.sequence)
      const payload = { requestKey: randomUUID(), question: '新一轮视觉研究' }
      await stranger
        .post(`/api/v1/research/ui/projects/${response.body.projectId}/runs`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', strangerCsrf)
        .send(payload)
        .expect(404)
      const round = await owner
        .post(`/api/v1/research/ui/projects/${response.body.projectId}/runs`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', csrf)
        .send(payload)
        .expect(201)
      expect(round.body.id).not.toBe(id)
      expect(round.body).not.toHaveProperty('state')
      expect(round.body.status).toBe('awaiting_plan')
    })
  }
)
