import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ApiClientError } from '@/lib/api-client-error'
import {
  CatalogLoadError,
  CatalogUnavailableFields,
} from './catalog-query-state'

describe('Catalog 查询状态', () => {
  it('说明不可用的来源字段，而不将其视为事实缺失', async () => {
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

  it('识别 Catalog 连接中断', async () => {
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
