import { type INestApplication } from '@nestjs/common'
import cookieParser from 'cookie-parser'
import { ApiExceptionFilter } from './common/api-exception.filter.js'

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1')
  app.use(cookieParser())
  app.useGlobalFilters(new ApiExceptionFilter())
}
