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
  pages_per_keyword: 5,
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
  publication_year: 2025,
  grant_year: 2026,
  cpcs: ['G06V'],
  matches: [{ domain_id: 'vision' }],
  ...source,
}
const company = {
  company_id: 'c1',
  preferred_name: 'Acme',
  legal_name: 'Acme',
  country: 'US',
  business_info: {},
  priority: 'high',
  summary: '值得进一步技术调研',
  patent_ids: ['p1'],
  relations: [
    {
      patent_id: 'p1',
      assignee_id: 'u1',
      assignee_name: 'Acme candidate',
      basis: 'search_hit',
    },
  ],
  ...source,
}
const subject = {
  assignee_id: 'u1',
  name: 'Acme candidate',
  patent_ids: ['p1'],
  candidates: [{ company_id: 'c1' }, { company_id: 'c2' }],
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
          max_requests: 300,
          max_cny: 10,
          max_seconds: 3600,
        },
        artifacts: {
          plan,
          confirmed_plan: plan,
          context: {
            period_from_year: 2019,
            period_to_year: 2025,
            domains: [{ domain_id: 'vision', name: '视觉' }],
          },
          execution_config: { workflow_version: 'browser-v3' },
          patents: [patent],
          assignees: [subject],
          company_leads: [company],
          snapshot: {
            release: { release_id: 'saved-v2' },
            patents: [patent],
            companies: [
              {
                company_id: 'c1',
                preferred_name: 'Acme',
                legal_name: 'Acme',
                country: 'US',
                business_info: {},
                ...source,
              },
              {
                company_id: 'c2',
                preferred_name: 'Different',
                legal_name: 'Different',
                country: 'US',
                business_info: {},
                ...source,
              },
            ],
            'external-identifiers': [],
            'company-aliases': [],
            'company-search-hits': [
              {
                assignee_id: 'u1',
                query_name: 'Acme candidate',
                company_id: 'c1',
                provider_rank: 0,
              },
              {
                assignee_id: 'u1',
                query_name: 'Acme candidate',
                company_id: 'c2',
                provider_rank: 1,
              },
            ],
            'patent-parties': [],
          },
          raw_private_material: 'NEVER_SEND'.repeat(100000),
          result: {
            release_id: 'saved-v2',
            patent_count: 1,
            companies: [
              company,
              {
                ...company,
                company_id: 'c2',
                preferred_name: 'Different',
                legal_name: 'Different',
                priority: 'medium',
              },
            ],
            patents: [
              { patent_id: 'p1', priority: 'high', reason: '技术相关' },
            ],
            missing: ['权属核验'],
            empty_reason: null,
            workflow_version: 'browser-v3',
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
                state: {
                  artifacts: {
                    execution_config: { workflow_version: 'browser-v3' },
                  },
                },
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
        releaseId: 'saved-v2',
        plan,
        confirmedPlan: plan,
        hasResult: true,
        workflowVersion: 'browser-v3',
        queriedAssigneeCount: 1,
        discoveredCompanyCount: 2,
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
        leadPatentCount: 1,
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
        source: { sha256: 'a'.repeat(64) },
      })
      const stats = await owner
        .get(`/api/v1/research/ui/runs/${id}/patent-stats`)
        .expect(200)
      expect(stats.body).toMatchObject({
        total: 1,
        classifications: [{ code: 'G06V', count: 1 }],
      })
      expect(
        (
          await owner
            .get(`/api/v1/research/ui/runs/${id}/patents?page=2`)
            .expect(200)
        ).body.items
      ).toEqual([])
      const candidates = await owner
        .get(`/api/v1/research/ui/runs/${id}/companies`)
        .expect(200)
      expect(candidates.body.total).toBe(2)
      expect(candidates.body.items[0]).toMatchObject({
        id: 'c1',
        queryNames: ['Acme candidate'],
        providerRank: 0,
      })
      const companyResult = await owner
        .get(`/api/v1/research/ui/runs/${id}/companies/c1`)
        .expect(200)
      expect(companyResult.body.relations).toEqual([
        { patentId: 'p1', assigneeName: 'Acme candidate', basis: 'search_hit' },
      ])
      expect(companyResult.body).not.toHaveProperty('resolution')
      expect(JSON.stringify(companyResult.body)).not.toContain('NEVER_SEND')
    })

    it('全部读取路径校验所有权；写入校验 CSRF；非法游标与分页返回 400', async () => {
      for (const suffix of [
        '',
        '/result',
        '/patents',
        '/patent-stats',
        '/company-stats',
        '/companies',
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

    it('轻量写入返回摘要，所有权和幂等动作生效，已完成项目不可重开', async () => {
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
      const payload = {
        thinking: true,
        requestKey: randomUUID(),
        question: '新一轮视觉研究',
      }
      await stranger
        .post(`/api/v1/research/ui/projects/${response.body.projectId}/runs`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', strangerCsrf)
        .send(payload)
        .expect(404)
      // The fixture also contains a queued sibling: explicitly stop it before a new round.
      await owner
        .post(`/api/v1/research/ui/projects/${response.body.projectId}/runs`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', csrf)
        .send(payload)
        .expect(409)
      await owner
        .post(`/api/v1/research/ui/runs/${queuedId}/actions`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', csrf)
        .send({ action_id: randomUUID(), kind: 'cancel' })
        .expect(201)
      await owner
        .post(`/api/v1/research/ui/projects/${response.body.projectId}/runs`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', csrf)
        .send(payload)
        .expect(409)
    })

    it('未执行项目的连续对话保存已选计划、建议确认和并发版本', async () => {
      const original = await prisma.researchRun.findUniqueOrThrow({
        where: { id },
        include: { project: true },
      })
      const project = await prisma.researchProject.create({
        data: {
          userId: original.project.userId,
          title: '计划讨论测试',
          question: '视觉计划讨论',
          requestKey: randomUUID(),
          runs: {
            create: {
              question: '生成视觉计划',
              requestKey: randomUUID(),
              status: 'awaiting_plan',
              state: { artifacts: { plan, candidate_plan: plan } },
            },
          },
        },
      })
      const projectId = project.id
      const url = `/api/v1/research/ui/projects/${projectId}/workspace`
      const post = (body: object) =>
        owner
          .post(url)
          .set('Origin', 'http://localhost:5173')
          .set('x-csrf-token', csrf)
          .send(body)
      await stranger.get(url).expect(404)
      const before = (await owner.get(url).expect(200)).body
      const selected = {
        ...plan,
        directions: [{ ...plan.directions[0], name: '我选定的视觉研究' }],
      }
      const save = {
        kind: 'save_plan',
        requestKey: randomUUID(),
        revision: before.revision,
        plan: selected,
      }
      const saved = (await post(save).expect(201)).body
      expect(saved.selectedPlan).toEqual(selected)
      expect(saved.revision).toBe(before.revision + 1)
      expect(
        saved.messages.some((m: { text: string }) =>
          m.text.includes('已保存研究计划')
        )
      ).toBe(false)
      expect((await post(save).expect(201)).body.revision).toBe(saved.revision)
      await post({ ...save, requestKey: randomUUID() }).expect(409)
      await post({ ...save, plan }).expect(409)
      const proposalId = randomUUID()
      const proposed = {
        ...selected,
        directions: [
          { ...selected.directions[0], explanation: '只调整选定的这一项' },
        ],
      }
      await prisma.researchRun.create({
        data: {
          id: proposalId,
          projectId,
          requestKey: randomUUID(),
          question: '修改描述',
          status: 'awaiting_plan',
          context: {
            workspace: true,
            selectedRevision: saved.revision,
            selectedPlan: selected,
          },
          state: {
            artifacts: {
              reply: '请应用修改',
              reply_intent: 'propose_selected',
              proposal_plan: proposed,
              candidate_plan: plan,
            },
          },
        },
      })
      const pending = (await owner.get(url).expect(200)).body
      expect(pending.selectedPlan).toEqual(selected)
      expect(pending.candidates).toEqual(plan)
      expect(
        pending.messages.find(
          (m: { runId: string; proposal: boolean }) =>
            m.runId === proposalId && m.proposal
        ).applied
      ).toBe(false)
      const apply = {
        kind: 'apply_proposal',
        requestKey: randomUUID(),
        revision: saved.revision,
        proposalRunId: proposalId,
      }
      const applied = (await post(apply).expect(201)).body
      expect(applied.selectedPlan).toEqual(proposed)
      expect(applied.candidates).toEqual(plan)
      expect(
        applied.messages.find(
          (m: { runId: string; proposal: boolean }) =>
            m.runId === proposalId && m.proposal
        ).applied
      ).toBe(true)
      await post({
        ...apply,
        requestKey: randomUUID(),
        revision: applied.revision,
      }).expect(409)
      await prisma.researchRun.update({
        where: { id: proposalId },
        data: { status: 'running' },
      })
      await post({
        kind: 'save_plan',
        requestKey: randomUUID(),
        revision: applied.revision,
        plan,
      }).expect(409)
      await prisma.researchRun.update({
        where: { id: proposalId },
        data: { status: 'awaiting_plan' },
      })
      const start = {
        kind: 'start_search',
        requestKey: randomUUID(),
        revision: applied.revision,
      }
      const started = (await post(start).expect(201)).body
      const execution = await prisma.researchRun.findUniqueOrThrow({
        where: { id: started.activeRunId },
      })
      expect(execution.context).toMatchObject({
        startSearch: true,
        selectedPlan: proposed,
        selectedRevision: applied.revision,
      })
      expect(
        started.messages.some(
          (message: { runId: string }) => message.runId === started.activeRunId
        )
      ).toBe(false)
      expect((await post(start).expect(201)).body.activeRunId).toBe(
        started.activeRunId
      )
      expect(JSON.stringify(started)).not.toContain('source_path')
    })

    it.each([
      'completed',
      'empty',
      'awaiting_companies',
      'recoverable',
      'failed',
      'cancelled',
    ] as const)(
      '%s 任务禁止重复研究和修改计划，后续聊天不解除锁定',
      async (status) => {
        const original = await prisma.researchRun.findUniqueOrThrow({
          where: { id },
          include: { project: true },
        })
        const project = await prisma.researchProject.create({
          data: {
            userId: original.project.userId,
            question: '禁止重复研究',
            title: '禁止重复研究',
            requestKey: randomUUID(),
            workspace: { revision: 0, selectedPlan: plan },
            runs: {
              create: [
                {
                  question: '已执行研究',
                  requestKey: randomUUID(),
                  status,
                  context: { startSearch: true },
                  state: {
                    node: 'finish',
                    artifacts: { confirmed_plan: plan },
                  },
                  createdAt: new Date('2026-09-12T00:00:00Z'),
                },
                {
                  question: '后续讨论',
                  requestKey: randomUUID(),
                  status: 'awaiting_plan',
                  createdAt: new Date('2026-09-12T00:01:00Z'),
                },
              ],
            },
          },
          include: { runs: { orderBy: { createdAt: 'asc' } } },
        })
        const url = `/api/v1/research/ui/projects/${project.id}/workspace`
        const post = (body: object) =>
          owner
            .post(url)
            .set('Origin', 'http://localhost:5173')
            .set('x-csrf-token', csrf)
            .send(body)
        const workspace = (await owner.get(url).expect(200)).body
        expect(workspace).toMatchObject({
          researchCompleted: ['completed', 'empty'].includes(status),
          executionRunId: project.runs[0].id,
          reachedStage: 'report',
        })
        await post({
          kind: 'start_search',
          requestKey: randomUUID(),
          revision: 0,
        }).expect(409)
        await post({
          kind: 'save_plan',
          requestKey: randomUUID(),
          revision: 0,
          plan,
        }).expect(409)
        await post({
          kind: 'apply_proposal',
          requestKey: randomUUID(),
          revision: 0,
          proposalRunId: project.runs[1].id,
        }).expect(409)
        for (const retryable of ['failed', 'cancelled'] as const) {
          await prisma.researchRun.updateMany({
            where: { projectId: project.id },
            data: { status: retryable },
          })
          const input = {
            kind: 'start_search',
            requestKey: randomUUID(),
            revision: 0,
          }
          await post(input).expect(409)
        }
      }
    )

    it('仅最新推荐提供候选卡片，普通讨论不替换推荐', async () => {
      const original = await prisma.researchRun.findUniqueOrThrow({
        where: { id },
        include: { project: true },
      })
      const project = await prisma.researchProject.create({
        data: {
          userId: original.project.userId,
          question: '推荐卡片测试',
          title: '推荐卡片测试',
          requestKey: randomUUID(),
          runs: {
            create: [
              {
                question: '最初推荐',
                requestKey: randomUUID(),
                status: 'awaiting_plan',
                createdAt: new Date('2026-09-12T00:00:00Z'),
                state: { artifacts: { plan } },
              },
              {
                question: '再推荐一次',
                requestKey: randomUUID(),
                status: 'awaiting_plan',
                createdAt: new Date('2026-09-12T00:00:01Z'),
                context: { workspace: true },
                state: {
                  artifacts: {
                    plan,
                    candidate_plan: plan,
                    reply: '新的推荐',
                    reply_intent: 'refresh_candidates',
                  },
                },
              },
              {
                question: '解释一下',
                requestKey: randomUUID(),
                status: 'awaiting_plan',
                createdAt: new Date('2026-09-12T00:00:02Z'),
                context: { workspace: true },
                state: {
                  artifacts: {
                    plan,
                    candidate_plan: plan,
                    reply: '仅解释',
                    reply_intent: 'discuss',
                  },
                },
              },
            ],
          },
        },
      })
      const response = (
        await owner
          .get(`/api/v1/research/ui/projects/${project.id}/workspace`)
          .expect(200)
      ).body
      const recommendations = response.messages.filter(
        (m: { recommendation?: boolean }) => m.recommendation
      )
      expect(recommendations).toHaveLength(2)
      expect(
        recommendations.map((m: { outdated: boolean }) => m.outdated)
      ).toEqual([true, false])
      expect(
        response.messages.find((m: { text: string }) => m.text === '仅解释')
          .plan
      ).toBeNull()
      expect(response.selectedPlan.directions).toEqual([])
    })
  }
)
