import { defineConfig } from 'prisma/config'
import { loadDatabaseEnvironment } from './src/environment.js'

loadDatabaseEnvironment()

// Generate/validate only; the Python service owns these tables and their migrations.
export default defineConfig({
  schema: 'prisma/catalog.prisma',
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
