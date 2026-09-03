import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ApiClientError } from '@/lib/api-client-error'
import {
  CatalogLoadError,
  CatalogUnavailableFields,
} from './catalog-query-state'

describe('Catalog query states', () => {
  it('explains unavailable source fields without treating them as absent facts', async () => {
    const screen = await render(
      <CatalogUnavailableFields fields={['abstract', 'claims']} />
    )

    await expect
      .element(screen.getByText(/abstract、claims/))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(/不代表相关事实不存在/))
      .toBeInTheDocument()
  })

  it('identifies a Catalog connection outage', async () => {
    const screen = await render(
      <CatalogLoadError
        error={
          new ApiClientError(503, {
            code: 'CATALOG_UNAVAILABLE',
            message: 'Catalog 查询暂时不可用',
            requestId: 'request-1',
          })
        }
      />
    )

    await expect
      .element(screen.getByText('技术目录暂时不可用'))
      .toBeInTheDocument()
    await expect.element(screen.getByText(/Catalog 数据库/)).toBeInTheDocument()
  })
})
