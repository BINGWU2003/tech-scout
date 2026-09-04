import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
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
        : HttpStatus.INTERNAL_SERVER_ERROR
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined
    const body: ExceptionBody = typeof raw === 'object' ? raw : {}
    const rawMessage = body.message ?? raw
    const message = Array.isArray(rawMessage)
      ? rawMessage.join(', ')
      : typeof rawMessage === 'string'
        ? rawMessage
        : status === HttpStatus.INTERNAL_SERVER_ERROR
          ? '服务器内部错误'
          : '请求失败'

    response.setHeader('x-request-id', requestId)
    response.status(status).json({
      code: body.code ?? `HTTP_${status}`,
      message,
      requestId,
      ...(body.details === undefined ? {} : { details: body.details }),
    })
  }
}
