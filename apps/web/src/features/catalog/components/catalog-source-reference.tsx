import { type CatalogSourceReference as CatalogSourceReferenceData } from '@tech-scout/contracts'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export function CatalogSourceReference({
  source,
}: {
  source: CatalogSourceReferenceData
}) {
  return (
    <dl className='grid gap-3 text-sm'>
      <div>
        <dt className='text-muted-foreground'>数据集 / release</dt>
        <dd className='flex flex-wrap gap-2'>
          <Badge variant='outline'>{source.dataset}</Badge>
          <span>{source.sourceRelease}</span>
        </dd>
      </div>
      <div>
        <dt className='text-muted-foreground'>逻辑路径 / 行号</dt>
        <dd className='font-mono text-xs break-all'>
          {source.relativePath ?? '未提供'} · {source.sourceRowNumber}
        </dd>
      </div>
      <div>
        <dt className='text-muted-foreground'>SHA-256</dt>
        <dd className='font-mono text-xs break-all'>{source.sha256}</dd>
      </div>
      {source.url ? (
        <div>
          <a
            className='inline-flex items-center gap-1 font-medium text-primary hover:underline'
            href={source.url}
            target='_blank'
            rel='noreferrer'
          >
            查看原始来源
            <ExternalLink className='size-3.5' />
          </a>
        </div>
      ) : null}
    </dl>
  )
}
