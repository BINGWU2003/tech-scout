import { z } from 'zod'

export const entityIdSchema = z.string().trim().min(1).max(255)

export const cursorPageQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const apiErrorSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
  details: z.unknown().optional(),
  status: z.number().int().min(0).max(599).optional(),
  action: z.enum(['none', 'reauthenticate']).optional(),
  retryable: z.boolean().optional(),
})

export const HTTP_STATUS = {
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const

export const clientErrorDefinitions = {
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  REQUEST_TIMEOUT: '请求超时，请稍后重试',
  INVALID_RESPONSE: '服务返回的数据格式不正确，请稍后重试',
  REQUEST_FAILED: '请求未能完成，请稍后重试',
} as const

export function apiErrorPolicy(status: number, code = `HTTP_${status}`) {
  return {
    status,
    action: (['AUTHENTICATION_REQUIRED', 'SESSION_INVALID'].includes(code)
      ? 'reauthenticate'
      : 'none') as 'reauthenticate' | 'none',
    retryable:
      status === 0 ||
      status === HTTP_STATUS.TOO_MANY_REQUESTS ||
      status >= HTTP_STATUS.INTERNAL_SERVER_ERROR,
  }
}

export function httpErrorMessage(status: number) {
  const messages: Record<number, string> = {
    400: '请求参数不正确',
    401: '身份验证失败',
    403: '没有权限执行此操作',
    404: '请求的资源不存在',
    409: '数据状态已变化，请刷新后重试',
    429: '请求过于频繁，请稍后重试',
    500: '服务器内部错误',
    502: '服务暂时不可用，请稍后重试',
    503: '服务暂时不可用，请稍后重试',
    504: '服务响应超时，请稍后重试',
  }
  return messages[status] ?? clientErrorDefinitions.REQUEST_FAILED
}

export function requiresAuthentication(error: ApiError) {
  return (
    (error.action ?? apiErrorPolicy(error.status ?? 0, error.code).action) ===
    'reauthenticate'
  )
}

export type ApiError = z.infer<typeof apiErrorSchema>
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>
