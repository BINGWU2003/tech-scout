import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { databaseUrl } from '../environment.js'
import { Prisma, PrismaClient } from '../generated/catalog/client.js'

@Injectable()
export class CatalogPrismaService implements OnModuleDestroy {
  private readonly client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl(), max: 5 }),
  })

  read<T>(
    query: (transaction: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return this.client.$transaction(
      async (transaction) => {
        // Transaction-local settings also work through Neon's transaction pooler.
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`
        await transaction.$executeRaw`SET LOCAL statement_timeout = '10s'`
        return query(transaction)
      },
      { maxWait: 10000, timeout: 15000 }
    )
  }

  async onModuleDestroy() {
    await this.client.$disconnect()
  }
}
