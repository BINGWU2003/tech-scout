import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { apiRequest } from './api-client'
import { resetApiErrors } from './api-error-notifications'

const errorToast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: errorToast, dismiss: vi.fn() } }))
beforeEach(() => {
  resetApiErrors()
  vi.clearAllMocks()
})
afterEach(() => vi.unstubAllGlobals())

it('从 Ky 已解析的错误体读取后端消息、错误码与状态', async () => {
  const body = {
    status: 409,
    code: 'PLAN_CHANGED',
    message: '已选计划已有更新，请刷新后确认',
    requestId: 'server-request',
    action: 'none',
    retryable: false,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(body), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  )
  await expect(apiRequest('test/plan', z.object({}))).rejects.toMatchObject({
    status: 409,
    message: body.message,
    payload: body,
  })
  expect(errorToast.mock.calls[0][0]).toBe(body.message)
})

it('网络故障和非 JSON 网关错误使用共享兜底，成功响应清除故障状态', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
  vi.stubGlobal('fetch', fetch)
  await expect(apiRequest('test/network', z.object({}))).rejects.toMatchObject({
    payload: {
      code: 'NETWORK_ERROR',
      message: '网络连接失败，请检查网络后重试',
    },
  })
  fetch.mockImplementation(
    async () => new Response('bad gateway', { status: 502 })
  )
  await expect(apiRequest('test/network', z.object({}))).rejects.toMatchObject({
    status: 502,
    payload: { code: 'HTTP_502', message: '服务暂时不可用，请稍后重试' },
  })
  fetch.mockImplementation(
    async () =>
      new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  await apiRequest('test/network', z.object({}))
  fetch.mockImplementation(
    async () => new Response('bad gateway', { status: 502 })
  )
  await expect(apiRequest('test/network', z.object({}))).rejects.toMatchObject({
    status: 502,
  })
  expect(errorToast).toHaveBeenCalledTimes(3)
})
