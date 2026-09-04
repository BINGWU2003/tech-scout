import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
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
import { CatalogCompanyDetail } from './catalog-company-detail'
import { CatalogLoadError } from './catalog-query-state'

export type CatalogCompanyReference = {
  companyId: string
  preferredName: string
}

type CatalogCompanyDetailDialogProps = {
  company: CatalogCompanyReference | null
  canGoBack: boolean
  onBack: () => void
  onOpenChange: (open: boolean) => void
  onRelatedCompanyOpen: (company: CatalogCompanyReference) => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}

function CompanyDialogBody({
  company,
  onRelatedCompanyOpen,
}: {
  company: CatalogCompanyReference
  onRelatedCompanyOpen: (company: CatalogCompanyReference) => void
}) {
  const query = useQuery({
    queryKey: ['catalog', 'company', company.companyId],
    queryFn: () => catalogApi.company(company.companyId),
  })

  if (query.isError) {
    return (
      <div className='space-y-3'>
        <CatalogLoadError error={query.error} title='公司详情加载失败' />
        <Button type='button' variant='outline' onClick={() => query.refetch()}>
          重试
        </Button>
      </div>
    )
  }

  if (!query.data) return <Skeleton className='h-96 rounded-xl' />

  return (
    <CatalogCompanyDetail
      company={query.data.company}
      onRelatedCompanyOpen={onRelatedCompanyOpen}
    />
  )
}

export function CatalogCompanyDetailDialog({
  company,
  canGoBack,
  onBack,
  onOpenChange,
  onRelatedCompanyOpen,
  returnFocusRef,
}: CatalogCompanyDetailDialogProps) {
  return (
    <Dialog open={company !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className='max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-6xl'
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
      >
        <DialogHeader className='pr-8'>
          {canGoBack ? (
            <Button
              className='mb-1 w-fit'
              type='button'
              size='sm'
              variant='ghost'
              onClick={onBack}
            >
              <ArrowLeft />
              返回上一家公司
            </Button>
          ) : null}
          <DialogTitle>{company?.preferredName ?? '公司详情'}</DialogTitle>
          <DialogDescription>
            公司身份、领域专利、关系和已接受的实体匹配。
          </DialogDescription>
        </DialogHeader>
        {company ? (
          <CompanyDialogBody
            company={company}
            onRelatedCompanyOpen={onRelatedCompanyOpen}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
