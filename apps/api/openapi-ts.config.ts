import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: '../../services/research/openapi.json',
  output: { path: 'src/generated/intelligence', importFileExtension: '.js' },
})
