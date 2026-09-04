import { useQuery } from '@tanstack/react-query'
import { type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogPatentDetail } from './catalog-patent-detail'
import { CatalogLoadError } from './catalog-query-state'

export type CatalogPatentReference = {
  patentId: string
  title: string
}

type CatalogPatentDetailDialogProps = {
  patent: CatalogPatentReference | null
  onOpenChange: (open: boolean) => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}

function PatentDialogBody({ patentId }: { patentId: string }) {
  const query = useQuery({
    queryKey: ['catalog', 'patent', patentId],
    queryFn: () => catalogApi.patent(patentId),
  })

  if (query.isError) {
    return (
      <div className='space-y-3'>
        <CatalogLoadError error={query.error} title='专利详情加载失败' />
        <Button type='button' variant='outline' onClick={() => query.refetch()}>
          重试
        </Button>
      </div>
    )
  }

  if (!query.data) return <Skeleton className='h-96 rounded-xl' />

  return <CatalogPatentDetail patent={query.data.patent} />
}

export function CatalogPatentDetailDialog({
  patent,
  onOpenChange,
  returnFocusRef,
}: CatalogPatentDetailDialogProps) {
  return (
    <Dialog open={patent !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-6xl'
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <DialogHeader className='pr-8'>
          <DialogTitle>{patent?.title ?? '专利详情'}</DialogTitle>
          <DialogDescription>
            专利书目、分类、参与方、领域匹配原因和来源追溯。
          </DialogDescription>
        </DialogHeader>
        {patent ? <PatentDialogBody patentId={patent.patentId} /> : null}
      </DialogContent>
    </Dialog>
  )
}
