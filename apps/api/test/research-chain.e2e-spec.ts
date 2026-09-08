import { randomUUID } from 'node:crypto'
import { type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/app.setup.js'

const enabled = Boolean(
  process.env.TEST_INTELLIGENCE_URL &&
  process.env.TEST_DATABASE_URL &&
  process.env.TEST_CATALOG_DATABASE_URL
)
const describeChain = enabled ? describe : describe.skip
describeChain(
  '阶段 2：真实 NestJS/Python/PostgreSQL 链路（本地模型桩）',
  () => {
    let app: INestApplication
    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
      process.env.CATALOG_DATABASE_URL = process.env.TEST_CATALOG_DATABASE_URL
      process.env.INTELLIGENCE_URL = process.env.TEST_INTELLIGENCE_URL
      process.env.INTELLIGENCE_INTERNAL_TOKEN =
        process.env.TEST_INTELLIGENCE_INTERNAL_TOKEN
      process.env.WEB_ORIGIN = 'http://localhost:5173'
      process.env.SESSION_COOKIE_SECURE = 'false'
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile()
      app = module.createNestApplication()
      configureApp(app)
      await app.init()
    })
    afterAll(async () => {
      await app?.close()
    })

    async function begin(question: string) {
      const agent = request.agent(app.getHttpServer())
      const username = 'chain_' + randomUUID().replaceAll('-', '').slice(0, 16)
      const account = await agent
        .post('/api/v1/auth/register')
        .set('Origin', 'http://localhost:5173')
        .send({
          username,
          email: `${username}@example.com`,
          password: 'chain test password',
        })
        .expect(201)
      const csrf = account.body.csrfToken
      const project = await agent
        .post('/api/v1/research/projects')
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', csrf)
        .send({ requestKey: randomUUID(), question })
        .expect(201)
      return { agent, csrf, id: project.body.runs[0].id }
    }

    async function waitFor(
      run: Awaited<ReturnType<typeof begin>>,
      statuses: string[]
    ) {
      const deadline = Date.now() + 25000
      while (Date.now() < deadline) {
        const response = await run.agent
          .get(`/api/v1/research/runs/${run.id}`)
          .expect(200)
        if (statuses.includes(response.body.status)) return response.body
        if (response.body.status === 'failed')
          throw new Error(JSON.stringify(response.body.state.error))
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error('运行状态等待超时')
    }

    it('确认计划后取得候选、引用快照、预算与可恢复事件', async () => {
      const run = await begin('寻找工业视觉边缘推理公司')
      const paused = await waitFor(run, ['awaiting_plan'])
      expect(paused.state.budget.requests).toBe(1)
      await run.agent
        .post(`/api/v1/research/runs/${run.id}/actions`)
        .set('Origin', 'http://localhost:5173')
        .set('x-csrf-token', run.csrf)
        .send({
          action_id: randomUUID(),
          kind: 'confirm_plan',
          plan: paused.state.artifacts.plan,
        })
        .expect(201)
      let finished = await waitFor(run, ['completed', 'awaiting_entities'])
      if (finished.status === 'awaiting_entities') {
        const decisions = finished.state.artifacts.unverified
          .filter(
            (u: { requires_confirmation: boolean }) => u.requires_confirmation
          )
          .map((u: { candidate_id: string }) => ({
            candidate_id: u.candidate_id,
            action: 'skip',
          }))
        await run.agent
          .post(`/api/v1/research/runs/${run.id}/actions`)
          .set('Origin', 'http://localhost:5173')
          .set('x-csrf-token', run.csrf)
          .send({
            action_id: randomUUID(),
            kind: 'resolve_entities',
            decisions,
          })
          .expect(201)
        finished = await waitFor(run, ['completed'])
      }
      expect(finished.state.artifacts.result.companies.length).toBeGreaterThan(
        0
      )
      expect(finished.state.artifacts.result.release_id).toBe('test-v1')
      expect(finished.state.budget.requests).toBe(2)
      expect(finished.state.artifacts.snapshot.patents[0]).toHaveProperty(
        'source_sha256'
      )
      const events = await run.agent
        .get(`/api/v1/research/runs/${run.id}/events?after=0`)
        .expect(200)
      expect(
        events.body.some((e: { kind: string }) => e.kind === 'awaiting_plan')
      ).toBe(true)
      expect(
        events.body.some((e: { kind: string }) => e.kind === 'model_usage')
      ).toBe(true)
      expect(events.body.map((e: { sequence: number }) => e.sequence)).toEqual(
        events.body.map((_: unknown, i: number) => i + 1)
      )
    }, 60000)

    it('模型错误通过产品 API 返回 failed，且不会读取专利或进入后续节点', async () => {
      const run = await begin('FAIL_MODEL')
      const failed = await waitFor(run, ['failed'])
      expect(failed.state.error.code).toBe('MODEL_REQUEST_FAILED')
      expect(failed.state.budget.requests).toBe(1)
      expect(failed.state.artifacts).not.toHaveProperty('snapshot')
      expect(failed.state.artifacts).not.toHaveProperty('result')
    }, 30000)
  }
)
