import { Database } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ApiClientError } from '@/lib/api-client-error'

export function CatalogLoadError({
  error,
  title = '数据加载失败',
}: {
  error: unknown
  title?: string
}) {
  const unavailable =
    error instanceof ApiClientError &&
    error.payload.code === 'CATALOG_UNAVAILABLE'

  return (
    <Alert variant='destructive'>
      <AlertTitle>{unavailable ? '技术目录暂时不可用' : title}</AlertTitle>
      <AlertDescription>
        {unavailable
          ? '无法连接 Catalog 数据库，请稍后重试；其他账户功能不受影响。'
          : error instanceof Error
            ? error.message
            : '请检查筛选条件或稍后重试。'}
      </AlertDescription>
    </Alert>
  )
}

export function CatalogUnavailableFields({ fields }: { fields: string[] }) {
  return (
    <Alert>
      <Database className='size-4' />
      <AlertTitle>数据覆盖说明</AlertTitle>
      <AlertDescription>
        当前发布缺少：{fields.join('、') || '未声明'}。空字段表示数据源未提供，
        不代表相关事实不存在。
      </AlertDescription>
    </Alert>
  )
}
