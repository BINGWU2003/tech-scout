import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { CatalogAvailabilityInterceptor } from './catalog-availability.interceptor.js'
import { CatalogController } from './catalog.controller.js'
import { CatalogDatabase } from './catalog.database.js'
import { CatalogRepository } from './catalog.repository.js'

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [
    CatalogDatabase,
    CatalogRepository,
    CatalogAvailabilityInterceptor,
  ],
  exports: [CatalogRepository],
})
export class CatalogModule {}
