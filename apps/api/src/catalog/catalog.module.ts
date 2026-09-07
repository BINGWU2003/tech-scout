import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { BrowserCatalogRepository } from './browser-catalog.repository.js'
import { CatalogAvailabilityInterceptor } from './catalog-availability.interceptor.js'
import { CatalogController } from './catalog.controller.js'
import { CatalogDatabase } from './catalog.database.js'
import { CatalogRepository } from './catalog.repository.js'

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [
    CatalogDatabase,
    {
      provide: CatalogRepository,
      inject: [CatalogDatabase],
      useFactory: (database: CatalogDatabase) =>
        process.env.RESEARCH_SOURCE_MODE === 'catalog'
          ? new CatalogRepository(database)
          : new BrowserCatalogRepository(database),
    },
    CatalogAvailabilityInterceptor,
  ],
  exports: [CatalogRepository],
})
export class CatalogModule {}
