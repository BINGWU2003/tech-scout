import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../environment.js'
import { PrismaClient } from '../generated/catalog/client.js'

@Injectable()
export class CatalogPrismaService
  extends PrismaClient
  implements OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: databaseUrl(),
        max: 5,
        options:
          '-c default_transaction_read_only=on -c statement_timeout=10000',
      }),
    })
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
