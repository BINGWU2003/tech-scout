import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common'
import {
  apiErrorPolicy,
  apiErrorSchema,
  httpErrorMessage,
  HTTP_STATUS,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { type Request, type Response } from 'express'

type ExceptionBody = {
  code?: string
  message?: string | string[]
  details?: unknown
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const request = context.getRequest<Request>()
    const response = context.getResponse<Response>()
    const requestId =
      request.header('x-request-id')?.slice(0, 100) || createRequestId()
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HTTP_STATUS.INTERNAL_SERVER_ERROR
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined
    const body: ExceptionBody = raw && typeof raw === 'object' ? raw : {}
    const rawMessage = body.message ?? raw
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(', ')
      : typeof rawMessage === 'string'
        ? rawMessage
        : httpErrorMessage(status)

    response.setHeader('x-request-id', requestId)
    response.status(status).json(
      apiErrorSchema.parse({
        ...apiErrorPolicy(status, body.code),
        code: body.code ?? `HTTP_${status}`,
        message: message.trim() || httpErrorMessage(status),
        requestId,
        ...(body.details === undefined ? {} : { details: body.details }),
      })
    )
  }
}
