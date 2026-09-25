import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

for (const file of ['../../.env', '.env']) {
  const envFile = new URL(file, import.meta.url)
  if (existsSync(envFile)) {
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(envFile, 'utf8'))
    )) {
      if (key.startsWith('TEST_') && value) process.env[key] ??= value
    }
  }
}
// Database suites never fall back to the shared application connection.
if (process.env.TEST_DATABASE_URL) {
  const url = new URL(process.env.TEST_DATABASE_URL)
  if (!decodeURIComponent(url.pathname).endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL 必须指向名称以 _test 结尾的独立测试库')
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
