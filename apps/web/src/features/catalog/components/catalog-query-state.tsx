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
      <AlertTitle>{unavailable ? '技术目录暂时无法访问' : title}</AlertTitle>
      <AlertDescription>
        {unavailable
          ? '暂时无法读取技术目录数据，请稍后重试。其他功能不受影响。'
          : '数据加载未完成，请稍后重试。'}
      </AlertDescription>
    </Alert>
  )
}

export function CatalogUnavailableFields({ fields }: { fields: string[] }) {
  return (
    <Alert>
      <Database className='size-4' />
      <AlertTitle>数据范围说明</AlertTitle>
      <AlertDescription>
        {fields.length
          ? `当前数据版本未提供：${fields.join('、')}。相关字段为空时，表示来源数据未包含该信息，并不代表事实不存在。`
          : '当前数据版本未声明缺失字段。'}
      </AlertDescription>
    </Alert>
  )
}
