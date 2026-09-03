import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common'
import { catchError, Observable, throwError } from 'rxjs'

@Injectable()
export class CatalogAvailabilityInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpException) return throwError(() => error)

        return throwError(
          () =>
            new ServiceUnavailableException({
              code: 'CATALOG_UNAVAILABLE',
              message: 'Catalog 查询暂时不可用',
            })
        )
      })
    )
  }
}
