import { apiErrorSchema, type ApiError } from '@tech-scout/contracts'
import ky, { HTTPError, type Options } from 'ky'
import { z, type ZodType } from 'zod'
import { useAuthStore } from '@/stores/auth-store'
import { ApiClientError } from './api-client-error'

const client = ky.create({
  prefix: '/api/v1/',
  credentials: 'include',
  hooks: {
    beforeRequest: [
      ({ request }) => {
        const csrfToken = useAuthStore.getState().auth.csrfToken
        if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          request.headers.set('x-csrf-token', csrfToken)
        }
      },
    ],
  },
})

function fallbackError(response: Response): ApiError {
  return {
    code: `HTTP_${response.status}`,
    message: '请求失败',
    requestId: response.headers.get('x-request-id') ?? crypto.randomUUID(),
  }
}

export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  options?: Options
): Promise<T> {
  try {
    const response = await client(path, options)
    if (response.status === 204) return undefined as T
    return schema.parse(await response.json())
  } catch (error) {
    if (error instanceof HTTPError) {
      const payload = apiErrorSchema.safeParse(
        await error.response.json().catch(() => undefined)
      )
      throw new ApiClientError(
        error.response.status,
        payload.success ? payload.data : fallbackError(error.response)
      )
    }
    if (error instanceof z.ZodError) {
      throw new Error('服务器返回了无法识别的数据')
    }
    throw error
  }
}
