import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AdminModule } from './admin/admin.module.js'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { AuthModule } from './auth/auth.module.js'
import { CatalogModule } from './catalog/catalog.module.js'
import { OriginMiddleware } from './common/origin.middleware.js'
import { ZodResponseInterceptor } from './common/zod-response.interceptor.js'
import { DatabaseModule } from './database/database.module.js'

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule, CatalogModule],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: ZodResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginMiddleware).forRoutes('*')
  }
}
