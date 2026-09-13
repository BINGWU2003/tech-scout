import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { researchEventSchema, researchStateSchema } from '@tech-scout/contracts'
import { createClient } from '../generated/intelligence/client/index.js'
import {
  actOnRun,
  deleteRun,
  getRun,
  listEvents,
  startRun,
} from '../generated/intelligence/sdk.gen.js'
import { type Action } from '../generated/intelligence/types.gen.js'

@Injectable()
export class IntelligenceClient {
  get configured() {
    return Boolean(
      process.env.INTELLIGENCE_URL && process.env.INTELLIGENCE_INTERNAL_TOKEN
    )
  }

  private options() {
    if (!this.configured)
      throw new ServiceUnavailableException({
        code: 'INTELLIGENCE_UNAVAILABLE',
        message: '研究服务尚未配置',
      })
    return {
      client: createClient({ baseUrl: process.env.INTELLIGENCE_URL }),
      headers: {
        Authorization: `Bearer ${process.env.INTELLIGENCE_INTERNAL_TOKEN}`,
      },
      signal: AbortSignal.timeout(15000),
    }
  }

  private async unwrap<T>(
    work: () => Promise<{ data?: T; error?: unknown; response?: Response }>
  ): Promise<T> {
    try {
      const response = await work()
      if (response.error || response.data === undefined) {
        const error = response.error as { code?: string; message?: string }
        if (response.response?.status === 409) {
          throw new HttpException(
            {
              code: error?.code ?? 'RESEARCH_CONFLICT',
              message: error?.message ?? '研究状态冲突',
            },
            409
          )
        }
        throw new Error('Invalid intelligence response')
      }
      return response.data
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw new ServiceUnavailableException({
        code: 'INTELLIGENCE_UNAVAILABLE',
        message: '研究服务暂不可用，已保存请求，可稍后重试',
      })
    }
  }

  async start(
    runId: string,
    question: string,
    conversation: Record<string, unknown> = {}
  ) {
    return this.forRun(
      runId,
      await this.unwrap(() =>
        startRun({
          ...this.options(),
          body: { run_id: runId, question, conversation },
        })
      )
    )
  }

  async get(runId: string) {
    return this.forRun(
      runId,
      await this.unwrap(() =>
        getRun({ ...this.options(), path: { run_id: runId } })
      )
    )
  }

  async delete(runId: string) {
    return this.unwrap(() =>
      deleteRun({ ...this.options(), path: { run_id: runId } })
    )
  }

  async action(runId: string, body: Action) {
    return this.forRun(
      runId,
      await this.unwrap(() =>
        actOnRun({ ...this.options(), path: { run_id: runId }, body })
      )
    )
  }

  async events(runId: string, after: number) {
    const data = await this.unwrap(() =>
      listEvents({
        ...this.options(),
        path: { run_id: runId },
        query: { after },
      })
    )
    return data.map((item) => {
      const event = researchEventSchema.parse(item)
      this.forRun(runId, event.data)
      if (event.sequence !== event.data.sequence)
        throw new Error('Event sequence mismatch')
      return event
    })
  }

  private forRun(runId: string, value: unknown) {
    const state = researchStateSchema.parse(value)
    if (state.run_id !== runId)
      throw new ServiceUnavailableException({
        code: 'INTELLIGENCE_PROTOCOL_ERROR',
        message: '研究服务返回了不匹配的运行标识',
      })
    return state
  }

  async *stream(runId: string, after: number, signal: AbortSignal) {
    const options = this.options()
    const response = await fetch(
      `${process.env.INTELLIGENCE_URL}/runs/${runId}/stream?after=${after}`,
      {
        headers: options.headers,
        signal,
      }
    )
    if (!response.ok || !response.body)
      throw new Error('Intelligence stream unavailable')
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })
      if (buffer.length > 50_000_000)
        throw new Error('Intelligence event too large')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) yield researchEventSchema.parse(JSON.parse(data))
      }
    }
  }
}
