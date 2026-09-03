import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common'
import { type NextFunction, type Request, type Response } from 'express'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

@Injectable()
export class OriginMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(request.method)) {
      next()
      return
    }
    const origin = request.header('origin')
    const expected = process.env.WEB_ORIGIN
    if (origin && expected && origin !== expected) {
      throw new ForbiddenException({
        code: 'ORIGIN_FORBIDDEN',
        message: '请求来源无效',
      })
    }
    next()
  }
}
