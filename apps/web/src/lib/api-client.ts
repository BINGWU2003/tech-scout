import {
  apiErrorSchema,
  apiErrorPolicy,
  HTTP_STATUS,
  clientErrorDefinitions,
  httpErrorMessage,
  type ApiError,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import ky, { HTTPError, TimeoutError, NetworkError, type Options } from 'ky'
import { z, type ZodType } from 'zod'
import { useAuthStore } from '@/stores/auth-store'
import { ApiClientError } from './api-client-error'
import { notifyApiError, recoverApiRequest } from './api-error-notifications'

const client = ky.create({
  prefix: '/api/v1/',
  credentials: 'include',
  retry: 0,
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
    ...apiErrorPolicy(response.status),
    code: `HTTP_${response.status}`,
    message: httpErrorMessage(response.status),
    requestId: response.headers.get('x-request-id') ?? createRequestId(),
  }
}

export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  options?: Options
): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase()
  const source = `${method} ${path.split('?')[0]}`
  try {
    const response = await client(path, options)
    const data =
      response.status === HTTP_STATUS.NO_CONTENT
        ? (undefined as T)
        : schema.parse(await response.json())
    recoverApiRequest(source)
    return data
  } catch (error) {
    if (
      options?.signal?.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw error
    let normalized: ApiClientError
    if (error instanceof HTTPError) {
      // Ky consumes the response body while populating HTTPError.data.
      const payload = apiErrorSchema.safeParse(error.data)
      normalized = new ApiClientError(
        error.response.status,
        payload.success
          ? {
              ...apiErrorPolicy(error.response.status, payload.data.code),
              ...payload.data,
              status: error.response.status,
            }
          : fallbackError(error.response),
        source,
        method
      )
    } else {
      const code =
        error instanceof TimeoutError
          ? 'REQUEST_TIMEOUT'
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? 'INVALID_RESPONSE'
            : error instanceof NetworkError || error instanceof TypeError
              ? 'NETWORK_ERROR'
              : 'REQUEST_FAILED'
      normalized = new ApiClientError(
        0,
        {
          ...apiErrorPolicy(0, code),
          code,
          message: clientErrorDefinitions[code],
          requestId: createRequestId(),
        },
        source,
        method
      )
    }
    notifyApiError(normalized)
    throw normalized
  }
}
