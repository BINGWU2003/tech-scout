import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    fileParallelism: false,
    root: './',
    include: ['**/*.e2e-spec.ts'],
  },
})
