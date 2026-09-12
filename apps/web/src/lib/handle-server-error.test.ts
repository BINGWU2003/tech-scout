import { beforeEach, expect, it, vi } from 'vitest'
import { ApiClientError } from './api-client-error'
import {
  configureApiErrors,
  notifyApiError,
  recoverApiRequest,
  resetApiErrors,
} from './api-error-notifications'
import { handleServerError } from './handle-server-error'

const errorToast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: errorToast, dismiss: vi.fn() } }))
beforeEach(() => {
  resetApiErrors()
  vi.clearAllMocks()
})
const failure = (source: string, requestId = crypto.randomUUID()) =>
  new ApiClientError(
    503,
    {
      code: 'INTELLIGENCE_UNAVAILABLE',
      message: '研究服务暂不可用',
      requestId,
    },
    source
  )

it('不同组件和轮询的同类故障只提示一次，所有失败请求恢复后可重新提示', () => {
  const first = failure('GET summary')
  notifyApiError(first)
  handleServerError(first)
  notifyApiError(failure('GET events'))
  notifyApiError(failure('GET summary'))
  expect(errorToast).toHaveBeenCalledTimes(1)
  recoverApiRequest('GET summary')
  notifyApiError(failure('GET events'))
  expect(errorToast).toHaveBeenCalledTimes(1)
  recoverApiRequest('GET events')
  notifyApiError(failure('GET summary'))
  expect(errorToast).toHaveBeenCalledTimes(2)
  expect(errorToast.mock.lastCall?.[0]).toBe('研究服务暂不可用')
})

it('主动重试和再次提交能提示失败，同一异常的局部处理不重复通知', () => {
  const retry = vi.fn().mockResolvedValue(undefined)
  configureApiErrors({ onAuthenticationRequired: vi.fn(), retryQueries: retry })
  notifyApiError(failure('GET summary'))
  errorToast.mock.lastCall?.[1].action.onClick()
  expect(retry).toHaveBeenCalledOnce()
  notifyApiError(failure('GET summary'))
  expect(errorToast).toHaveBeenCalledTimes(2)
  const write = () =>
    new ApiClientError(
      409,
      {
        code: 'HTTP_409',
        message: '计划已有更新',
        requestId: crypto.randomUUID(),
      },
      'POST plan',
      'POST'
    )
  const first = write()
  notifyApiError(first)
  handleServerError(first)
  notifyApiError(write())
  expect(errorToast).toHaveBeenCalledTimes(4)
})

it('凭据错误不跳转，明确的会话失效只处理一次', () => {
  const redirect = vi.fn()
  configureApiErrors({
    onAuthenticationRequired: redirect,
    retryQueries: vi.fn(),
  })
  notifyApiError(
    new ApiClientError(401, {
      code: 'INVALID_CREDENTIALS',
      message: '账号或密码错误',
      requestId: '1',
      action: 'none',
    })
  )
  expect(redirect).not.toHaveBeenCalled()
  for (const source of ['GET summary', 'GET events'])
    notifyApiError(
      new ApiClientError(
        401,
        {
          code: 'SESSION_INVALID',
          message: '登录已失效',
          requestId: '2',
          action: 'reauthenticate',
        },
        source
      )
    )
  expect(redirect).toHaveBeenCalledOnce()
})
