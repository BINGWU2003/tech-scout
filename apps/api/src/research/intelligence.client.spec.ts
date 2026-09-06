import { randomUUID } from 'node:crypto'
import { IntelligenceClient } from './intelligence.client.js'

describe('Intelligence 内部响应隔离', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  it.each(['start', 'get', 'action', 'events'] as const)(
    '拒绝 %s 返回其他运行的合法结构',
    async (method) => {
      vi.stubEnv('INTELLIGENCE_URL', 'http://127.0.0.1:18001')
      vi.stubEnv('INTELLIGENCE_INTERNAL_TOKEN', 'fixture-token')
      const runId = randomUUID()
      const wrong = {
        run_id: randomUUID(),
        sequence: 1,
        status: 'running',
        node: null,
        error: null,
        artifacts: {},
        budget: {
          requests: 0,
          reserved_cny: 0,
          estimated_cny: 0,
          elapsed_seconds: 0,
          input_tokens: 0,
          output_tokens: 0,
          max_requests: 6,
          max_seconds: 300,
          max_cny: 1,
        },
      }
      const body =
        method === 'events'
          ? [
              {
                sequence: 1,
                kind: 'started',
                created_at: new Date().toISOString(),
                data: wrong,
              },
            ]
          : wrong
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
        )
      )
      const client = new IntelligenceClient()
      const promise =
        method === 'start'
          ? client.start(runId, '视觉')
          : method === 'get'
            ? client.get(runId)
            : method === 'events'
              ? client.events(runId, 0)
              : client.action(runId, {
                  action_id: randomUUID(),
                  actor_id: randomUUID(),
                  kind: 'cancel',
                })
      await expect(promise).rejects.toThrow('研究服务返回了不匹配的运行标识')
    }
  )
})
