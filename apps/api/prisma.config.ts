import { defineConfig } from 'prisma/config'
import { loadDatabaseEnvironment } from './src/environment.js'

loadDatabaseEnvironment()

// Prisma CLI also uses the connection's default schema for migration history.
// Keep this aligned with the runtime adapter and @@schema("app"), while .env
// only specifies the database connection.
const databaseUrl = process.env.DATABASE_URL
const migrationUrl = databaseUrl ? new URL(databaseUrl) : undefined
migrationUrl?.searchParams.set('schema', 'app')

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: migrationUrl?.toString() ?? '' },
})
