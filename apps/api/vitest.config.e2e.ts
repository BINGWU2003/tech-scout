import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const envFile = new URL('.env', import.meta.url)
if (existsSync(envFile)) {
  for (const [key, value] of Object.entries(
    parseEnv(readFileSync(envFile, 'utf8'))
  )) {
    if (key.startsWith('TEST_') && value) process.env[key] ??= value
  }
}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    fileParallelism: false,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
})
