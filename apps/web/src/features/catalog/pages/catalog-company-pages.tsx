import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  catalogCompanyListQuerySchema,
  catalogCompanyPatentListQuerySchema,
} from '@tech-scout/contracts'
import { Skeleton } from '@/components/ui/skeleton'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogCompanyTable } from '../components/catalog-company-table'
import { CatalogPatentTable } from '../components/catalog-patent-table'
import { CatalogLoadError } from '../components/catalog-query-state'
import { CatalogShell } from '../components/catalog-shell'
import { useCatalogQueryState } from '../hooks/use-catalog-query-state'

const companyPatentsRoute = getRouteApi(
  '/_authenticated/catalog/companies/$companyId/patents'
)

export function CatalogCompaniesPage() {
  const { query, updateQuery } = useCatalogQueryState(
    catalogCompanyListQuerySchema
  )
  const companies = useQuery({
    queryKey: ['catalog', 'companies', query],
    queryFn: () => catalogApi.companies(query),
    placeholderData: keepPreviousData,
  })

  return (
    <CatalogShell
      title='公司目录'
      description='浏览当前发布中已确认的公司主体，并按名称、别名或外部标识检索。'
      releaseId={companies.data?.release.releaseId}
    >
      {companies.isError ? (
        <CatalogLoadError error={companies.error} title='公司目录加载失败' />
      ) : companies.data ? (
        <CatalogCompanyTable
          result={companies.data}
          query={query}
          onQueryChange={updateQuery}
        />
      ) : (
        <Skeleton className='h-96 rounded-xl' />
      )}
    </CatalogShell>
  )
}

export function CatalogCompanyPatentsPage() {
  const { companyId } = companyPatentsRoute.useParams()
  const { query, updateQuery } = useCatalogQueryState(
    catalogCompanyPatentListQuerySchema
  )
  const company = useQuery({
    queryKey: ['catalog', 'company', companyId],
    queryFn: () => catalogApi.company(companyId),
  })
  const patents = useQuery({
    queryKey: ['catalog', 'company-patents', companyId, query],
    queryFn: () => catalogApi.companyPatents(companyId, query),
    placeholderData: keepPreviousData,
  })
  const error = company.error ?? patents.error

  return (
    <CatalogShell
      title={`${company.data?.company.preferredName ?? '公司'}的专利`}
      description={
        query.domainId
          ? `已限定领域：${query.domainId}`
          : '当前发布中与该公司已接受匹配关联的全部专利。'
      }
      releaseId={patents.data?.release.releaseId}
      backHref='/catalog/companies'
    >
      {error ? (
        <CatalogLoadError error={error} title='公司专利加载失败' />
      ) : patents.data ? (
        <CatalogPatentTable
          result={patents.data}
          query={query}
          onQueryChange={updateQuery}
        />
      ) : (
        <Skeleton className='h-96 rounded-xl' />
      )}
    </CatalogShell>
  )
}
