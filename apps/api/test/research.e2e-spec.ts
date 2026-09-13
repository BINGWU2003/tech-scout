import { randomUUID } from 'node:crypto'
import {
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { type ResearchState } from '@tech-scout/contracts'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/app.setup.js'
import { PrismaService } from '../src/database/prisma.service.js'
import { IntelligenceClient } from '../src/research/intelligence.client.js'
import { ResearchService } from '../src/research/research.service.js'

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip
describeDb('阶段 2 产品 API：所有权、幂等与持久化', () => {
  let app: INestApplication
  let prisma: PrismaService
  const states = new Map<string, ResearchState>()
  const client = {
    configured: false,
    delete: vi.fn(async (id: string) => {
      states.delete(id)
      return { deleted: true }
    }),
    start: vi.fn(async (id: string) => {
      if (!states.has(id))
        states.set(id, {
          run_id: id,
          status: 'awaiting_plan',
          sequence: 1,
          node: 'plan_gate',
          error: null,
          artifacts: { plan: { risks: ['test'] } },
          budget: {
            requests: 1,
            reserved_cny: 0.03,
            estimated_cny: 0.01,
            elapsed_seconds: 0.1,
            input_tokens: 100,
            output_tokens: 20,
            max_requests: 6,
            max_seconds: 300,
            max_cny: 1,
          },
        })
      return states.get(id)!
    }),
    events: vi.fn(async (id: string, after: number) =>
      after < 1
        ? [
            {
              sequence: 1,
              kind: 'execution_stopped',
              created_at: new Date().toISOString(),
              data: states.get(id)!,
            },
          ]
        : []
    ),
    action: vi.fn(async (id: string, body: { kind: string }) => {
      const state = {
        ...states.get(id)!,
        sequence: 2,
        status:
          body.kind === 'cancel' ? ('cancelled' as const) : ('queued' as const),
      }
      states.set(id, state)
      return state
    }),
    async *stream() {
      /* No background events in this deterministic transport fixture. */
    },
  }
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    process.env.CATALOG_DATABASE_URL =
      process.env.TEST_CATALOG_DATABASE_URL ?? process.env.TEST_DATABASE_URL
    process.env.WEB_ORIGIN = 'http://localhost:5173'
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IntelligenceClient)
      .useValue(client)
      .compile()
    app = module.createNestApplication()
    configureApp(app)
    await app.init()
    prisma = app.get(PrismaService)
  })
  afterAll(async () => {
    await app?.close()
  })

  async function account() {
    const agent = request.agent(app.getHttpServer())
    const name = 'r' + randomUUID().replaceAll('-', '').slice(0, 20)
    const registration = await agent
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send({
        username: name,
        email: `${name}@example.com`,
        password: 'a secure test password',
      })
      .expect(201)
    return { agent, csrf: registration.body.csrfToken }
  }

  it('删除要求身份及 CSRF；失败保留任务；成功级联删除且忽略迟到事件', async () => {
    const owner = await account()
    const other = await account()
    const created = await owner.agent
      .post('/api/v1/research/projects')
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .send({
        thinking: true,
        requestKey: randomUUID(),
        question: '待删除研究',
      })
      .expect(201)
    const projectId = created.body.id
    const runId = created.body.runs[0].id
    const state = states.get(runId)!
    const url = `/api/v1/research/projects/${projectId}`
    await request(app.getHttpServer()).delete(url).expect(401)
    await owner.agent
      .delete(url)
      .set('Origin', 'http://localhost:5173')
      .expect(401)
    await other.agent
      .delete(url)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', other.csrf)
      .expect(200)
    expect(
      await prisma.researchProject.findUnique({ where: { id: projectId } })
    ).not.toBeNull()
    client.delete.mockRejectedValueOnce(
      new ServiceUnavailableException('停止失败')
    )
    await owner.agent
      .delete(url)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .expect(503)
    await owner.agent.get(url).expect(200)
    const deleted = await owner.agent
      .delete(url)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .expect(200)
    expect(deleted.body).toEqual({ deleted: true, runIds: [runId] })
    await owner.agent.get(url).expect(404)
    await owner.agent.get(`/api/v1/research/runs/${runId}`).expect(404)
    await app
      .get(ResearchService)
      .receive({
        sequence: state.sequence,
        kind: 'state',
        created_at: new Date().toISOString(),
        data: state,
      })
    expect(await prisma.researchEvent.count({ where: { runId } })).toBe(0)
    await owner.agent
      .delete(url)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .expect(200)
  })

  it('项目请求幂等；跨用户读取、写入和事件均被隔离；写入要求 CSRF', async () => {
    const owner = await account()
    const other = await account()
    const input = {
      thinking: true,
      requestKey: randomUUID(),
      question: '工业视觉边缘推理',
    }
    const missingCsrf = await owner.agent
      .post('/api/v1/research/projects')
      .set('Origin', 'http://localhost:5173')
      .send(input)
      .expect(401)
    expect(missingCsrf.body.code).toBe('CSRF_TOKEN_INVALID')
    const created = await owner.agent
      .post('/api/v1/research/projects')
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .send(input)
      .expect(201)
    const duplicate = await owner.agent
      .post('/api/v1/research/projects')
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .send(input)
      .expect(201)
    expect(duplicate.body.id).toBe(created.body.id)
    const id = created.body.runs[0].id
    expect(created.body).not.toHaveProperty('userId')
    await other.agent
      .get(`/api/v1/research/projects/${created.body.id}`)
      .expect(404)
    await other.agent.get(`/api/v1/research/runs/${id}`).expect(404)
    await other.agent.get(`/api/v1/research/runs/${id}/events`).expect(404)
    await other.agent.get(`/api/v1/research/runs/${id}/stream`).expect(404)
    await other.agent
      .post(`/api/v1/research/runs/${id}/actions`)
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', other.csrf)
      .send({ action_id: randomUUID(), kind: 'cancel' })
      .expect(404)
    const fetched = await owner.agent
      .get(`/api/v1/research/runs/${id}`)
      .expect(200)
    expect(fetched.body.state.artifacts.plan.risks).toEqual(['test'])
    const action = { action_id: randomUUID(), kind: 'cancel' }
    const before = client.action.mock.calls.length
    for (let i = 0; i < 2; i++)
      await owner.agent
        .post(`/api/v1/research/runs/${id}/actions`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', owner.csrf)
        .send(action)
        .expect(201)
    expect(client.action.mock.calls.length - before).toBe(1)
    await owner.agent
      .post('/api/v1/research/projects')
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .send({ ...input, question: '不同问题' })
      .expect(409)
    expect(
      await prisma.researchRun.count({ where: { projectId: created.body.id } })
    ).toBe(1)
  })

  it('重复和乱序事件不会回退状态；事件可按游标恢复', async () => {
    const owner = await account()
    const created = await owner.agent
      .post('/api/v1/research/projects')
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .send({ thinking: true, requestKey: randomUUID(), question: '视觉' })
      .expect(201)
    const id = created.body.runs[0].id
    const service = app.get(ResearchService)
    const state = states.get(id)!
    const event = {
      sequence: 3,
      kind: 'failed',
      created_at: new Date().toISOString(),
      data: {
        ...state,
        sequence: 3,
        status: 'failed' as const,
        error: { code: 'MODEL_REQUEST_FAILED', message: '模型请求失败' },
      },
    }
    await service.receive(event)
    await service.receive(event)
    await service.receive({
      ...event,
      sequence: 2,
      data: { ...state, sequence: 2 },
    })
    const fetched = await owner.agent
      .get(`/api/v1/research/runs/${id}`)
      .expect(200)
    expect(fetched.body.status).toBe('failed')
    const list = await owner.agent.get('/api/v1/research/projects').expect(200)
    expect(
      list.body.find((p: { id: string }) => p.id === created.body.id).activity
    ).toMatchObject({
      runId: id,
      status: 'failed',
      sequence: 3,
      label: '执行失败',
    })

    const events = await owner.agent
      .get(`/api/v1/research/runs/${id}/events?after=1`)
      .expect(200)
    expect(events.body.map((e: { sequence: number }) => e.sequence)).toEqual([
      2, 3,
    ])
  })

  it('并发相同创建请求只产生一个项目和运行', async () => {
    const owner = await account()
    const input = {
      thinking: true,
      requestKey: randomUUID(),
      question: '并发研究',
    }
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        owner.agent
          .post('/api/v1/research/projects')
          .set('Origin', 'http://localhost:5173')
          .set('x-csrf-token', owner.csrf)
          .send(input)
          .expect(201)
      )
    )
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1)
    expect(
      await prisma.researchRun.count({
        where: { projectId: responses[0].body.id },
      })
    ).toBe(1)
  })
  it('追问继承上轮条件，重复请求不新增轮次，旧轮次不能恢复执行', async () => {
    const owner = await account()
    const post = (url: string, body: object) =>
      owner.agent
        .post(url)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', owner.csrf)
        .send(body)
    const created = await post('/api/v1/research/projects', {
      requestKey: randomUUID(),
      question: '工业视觉',
      thinking: true,
    }).expect(201)
    const projectId = created.body.id,
      parentRunId = created.body.runs[0].id
    const input = {
      requestKey: randomUUID(),
      question: '只看近五年',
      thinking: true,
      parentRunId,
    }
    const responses = await Promise.all([
      post(`/api/v1/research/projects/${projectId}/runs`, input).expect(201),
      post(`/api/v1/research/projects/${projectId}/runs`, input).expect(201),
    ])
    expect(responses[0].body.id).toBe(responses[1].body.id)
    const saved = await prisma.researchRun.findUniqueOrThrow({
      where: { id: responses[0].body.id },
    })
    expect(saved.context).toMatchObject({
      parentRunId,
      originalQuestion: '工业视觉',
      questions: ['工业视觉'],
      plan: { risks: ['test'] },
    })
    expect(await prisma.researchRun.count({ where: { projectId } })).toBe(2)
    await post(`/api/v1/research/projects/${projectId}/runs`, {
      ...input,
      question: '不同追问',
    }).expect(409)
    await post(`/api/v1/research/runs/${parentRunId}/actions`, {
      action_id: randomUUID(),
      kind: 'retry',
    }).expect(409)
    await post(`/api/v1/research/projects/${projectId}/runs`, {
      ...input,
      requestKey: randomUUID(),
    }).expect(409)
    await prisma.researchRun.update({
      where: { id: saved.id },
      data: { status: 'running' },
    })
    await post(`/api/v1/research/projects/${projectId}/runs`, {
      ...input,
      parentRunId: saved.id,
      requestKey: randomUUID(),
    }).expect(409)
  })

  it('思考事件按游标回放，历史消息保留内容，异常结构直接拒绝', async () => {
    const owner = await account()
    const input = {
      requestKey: randomUUID(),
      question: '思考流测试',
      thinking: true,
    }
    const post = (body: object) =>
      owner.agent
        .post('/api/v1/research/projects')
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', owner.csrf)
        .send(body)
    const created = await post(input).expect(201)
    await post({ ...input, thinking: false }).expect(409)
    const id = created.body.runs[0].id
    const service = app.get(ResearchService)
    const initial = states.get(id)!
    const reasoning = {
      id: randomUUID(),
      status: 'thinking',
      text: '先梳理研究范围。',
      startedAt: new Date().toISOString(),
      durationMs: 1000,
      truncated: false,
    }
    await service.receive({
      sequence: 2,
      kind: 'reasoning_progress',
      created_at: new Date().toISOString(),
      data: {
        ...initial,
        sequence: 2,
        status: 'running',
        node: 'planner',
        artifacts: { reasoning },
      },
    })
    const progress = await owner.agent
      .get(`/api/v1/research/ui/runs/${id}/events?after=1`)
      .expect(200)
    expect(progress.body[0].reasoning).toEqual(reasoning)
    const workspaceUrl = `/api/v1/research/ui/projects/${created.body.id}/workspace`
    const pending = await owner.agent.get(workspaceUrl).expect(200)
    expect(pending.body.messages.at(-1)).toMatchObject({
      pending: true,
      text: '',
      reasoning,
    })
    const answer = {
      id: reasoning.id,
      startedAt: reasoning.startedAt,
      status: 'streaming',
      text: '结合需求，',
    }
    await service.receive({
      sequence: 3,
      kind: 'answer_progress',
      created_at: new Date().toISOString(),
      data: {
        ...initial,
        sequence: 3,
        status: 'running',
        node: 'planner',
        artifacts: {
          reasoning: { ...reasoning, status: 'answering' },
          answer,
        },
      },
    })
    const partial = await owner.agent.get(workspaceUrl).expect(200)
    expect(partial.body.messages.at(-1)).toMatchObject({
      pending: true,
      text: '',
      plan: null,
      answer,
    })
    const answerEvents = await owner.agent
      .get(`/api/v1/research/ui/runs/${id}/events?after=2`)
      .expect(200)
    expect(answerEvents.body[0].answer).toEqual(answer)
    await service.receive({
      sequence: 4,
      kind: 'node_completed',
      created_at: new Date().toISOString(),
      data: {
        ...initial,
        sequence: 4,
        artifacts: {
          reply: '最终回答',
          answer: { ...answer, text: '最终回答', status: 'completed' },
          reasoning: { ...reasoning, status: 'completed' },
        },
      },
    })
    const history = await owner.agent.get(workspaceUrl).expect(200)
    expect(history.body.messages.at(-1)).toMatchObject({
      pending: false,
      text: '最终回答',
      answer: { ...answer, text: '最终回答', status: 'completed' },
      reasoning: { ...reasoning, status: 'completed' },
    })
    const other = await account()
    await other.agent.get(workspaceUrl).expect(404)
    await other.agent.get(`/api/v1/research/ui/runs/${id}/events`).expect(404)
    await prisma.researchRun.update({
      where: { id },
      data: { state: { artifacts: { reasoning: { text: '无效数据' } } } },
    })
    await owner.agent.get(workspaceUrl).expect(500)
  })

  it('过程记录持久化并可按游标回放，投影不会泄露内部字段', async () => {
    const owner = await account()
    const created = await owner.agent
      .post('/api/v1/research/projects')
      .set('Origin', 'http://localhost:5173')
      .set('x-csrf-token', owner.csrf)
      .send({
        thinking: true,
        requestKey: randomUUID(),
        question: '专利过程测试',
      })
      .expect(201)
    const id = created.body.runs[0].id
    const state = states.get(id)!
    const service = app.get(ResearchService)
    await service.receive({
      sequence: 2,
      kind: 'search_progress',
      created_at: new Date().toISOString(),
      data: {
        ...state,
        sequence: 2,
        artifacts: {
          ...state.artifacts,
          process: {
            stage: 'search',
            message: '检索完成',
            outcome: 'completed',
            keyword: '视觉',
            page: 1,
            count: 7,
            url: 'https://patents.google.com/?q=vision',
            private_token: 'do-not-expose',
          },
        },
      },
    })
    const events = await owner.agent
      .get(`/api/v1/research/ui/runs/${id}/events?after=1`)
      .expect(200)
    expect(events.body).toHaveLength(1)
    expect(events.body[0].process).toMatchObject({ keyword: '视觉', count: 7 })
    expect(events.body[0].process).not.toHaveProperty('private_token')
    const replay = await owner.agent
      .get(`/api/v1/research/ui/runs/${id}/events?after=1`)
      .expect(200)
    expect(replay.body).toEqual(events.body)
    const other = await account()
    await other.agent.get(`/api/v1/research/ui/runs/${id}/events`).expect(404)
  })
})
