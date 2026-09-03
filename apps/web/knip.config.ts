import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // MSW is reserved for the next cross-browser API integration test slice.
  ignoreDependencies: ['msw'],
  ignore: [
    'src/components/ui/**',
    'src/components/layout/app-title.tsx',
    'src/tanstack-table.d.ts',
  ],
}

export default config
