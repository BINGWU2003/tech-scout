import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { AdminModule } from './admin/admin.module.js'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { AuthModule } from './auth/auth.module.js'
import { OriginMiddleware } from './common/origin.middleware.js'
import { DatabaseModule } from './database/database.module.js'

@Module({
  imports: [DatabaseModule, AuthModule, AdminModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginMiddleware).forRoutes('*')
  }
}
