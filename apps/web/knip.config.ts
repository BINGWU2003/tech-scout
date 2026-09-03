import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // Installed for the first real API slice; remove these exceptions when wired.
  ignoreDependencies: ['ky', 'msw'],
  ignore: [
    'src/components/ui/**',
    'src/components/layout/app-title.tsx',
    'src/tanstack-table.d.ts',
  ],
}

export default config
