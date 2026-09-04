import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Request } from 'express'
import { type Observable, map } from 'rxjs'
import { type ZodType } from 'zod'
import { ZOD_RESPONSE_SCHEMA } from './zod-response.decorator.js'

@Injectable()
export class ZodResponseInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ZodResponseInterceptor.name)

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<ZodType>(
      ZOD_RESPONSE_SCHEMA,
      context.getHandler()
    )
    if (!schema) return next.handle()

    return next.handle().pipe(
      map((response: unknown) => {
        const result = schema.safeParse(response)
        if (result.success) return response

        const request = context.switchToHttp().getRequest<Request>()
        this.logger.error({
          message: '响应契约校验失败',
          method: request.method,
          url: request.originalUrl,
          issues: result.error.issues.map((issue) => ({
            code: issue.code,
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        })
        throw new InternalServerErrorException({
          code: 'RESPONSE_VALIDATION_ERROR',
          message: '服务器响应校验失败',
        })
      })
    )
  }
}
