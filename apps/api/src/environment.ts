import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

export const databaseEnvFile = new URL('../../../.env', import.meta.url)
const serviceEnvFile = new URL('../.env', import.meta.url)

export function loadDatabaseEnvironment(file: URL = databaseEnvFile): void {
  if (!existsSync(file)) return
  const { DATABASE_URL } = parseEnv(readFileSync(file, 'utf8'))
  if (DATABASE_URL) process.env.DATABASE_URL ??= DATABASE_URL
}

export function loadServiceEnvironment(file: URL = serviceEnvFile): void {
  if (!existsSync(file)) return
  for (const [key, value] of Object.entries(
    parseEnv(readFileSync(file, 'utf8'))
  )) {
    // Database connections have one source: the repository root or process env.
    if (!key.endsWith('DATABASE_URL')) process.env[key] ??= value
  }
}

export function databaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value)
    throw new Error(
      'DATABASE_URL is required in the root .env or process environment'
    )
  return value
}
