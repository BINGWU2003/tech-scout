import { apiErrorSchema, type ApiError } from '@tech-scout/contracts'

export class ApiClientError extends Error {
  readonly status: number
  readonly payload: ApiError

  constructor(status: number, payload: ApiError) {
    const validatedPayload = apiErrorSchema.parse(payload)
    super(validatedPayload.message)
    this.name = 'ApiClientError'
    this.status = status
    this.payload = validatedPayload
  }
}
