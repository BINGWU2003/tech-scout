import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { defineConfig } from 'prisma/config'

if (existsSync(new URL('.env', import.meta.url)))
  loadEnvFile(new URL('.env', import.meta.url))

// Generate/validate only; the Python service owns these tables and their migrations.
export default defineConfig({
  schema: 'prisma/catalog.prisma',
  datasource: { url: process.env.CATALOG_DATABASE_URL ?? '' },
})
