import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely'
import { Pool } from 'pg'
import { type DB } from '../generated/catalog.database.js'

function catalogDatabaseUrl(): string {
  const value = process.env.CATALOG_DATABASE_URL
  if (!value) throw new Error('CATALOG_DATABASE_URL is required')
  return value
}

@Injectable()
export class CatalogDatabase extends Kysely<DB> implements OnModuleDestroy {
  constructor() {
    super({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: catalogDatabaseUrl(),
          max: 5,
          options:
            '-c search_path=catalog -c default_transaction_read_only=on -c statement_timeout=5000',
        }),
      }),
      plugins: [new CamelCasePlugin()],
    })
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroy()
  }
}
