import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  catalogCompanyListQuerySchema,
  catalogPatentListQuerySchema,
} from '@tech-scout/contracts'
import { Skeleton } from '@/components/ui/skeleton'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogCompanyTable } from '../components/catalog-company-table'
import { CatalogPatentTable } from '../components/catalog-patent-table'
import { CatalogLoadError } from '../components/catalog-query-state'
import { CatalogDomainTabs, CatalogShell } from '../components/catalog-shell'
import { useCatalogQueryState } from '../hooks/use-catalog-query-state'

const companiesRoute = getRouteApi(
  '/_authenticated/catalog/domains/$domainId/companies'
)
const patentsRoute = getRouteApi(
  '/_authenticated/catalog/domains/$domainId/patents'
)

export function CatalogDomainCompaniesPage() {
  const { domainId } = companiesRoute.useParams()
  const { query, updateQuery } = useCatalogQueryState(
    catalogCompanyListQuerySchema
  )
  const domain = useQuery({
    queryKey: ['catalog', 'domain', domainId],
    queryFn: () => catalogApi.domain(domainId),
  })
  const companies = useQuery({
    queryKey: ['catalog', 'domain-companies', domainId, query],
    queryFn: () => catalogApi.domainCompanies(domainId, query),
    placeholderData: keepPreviousData,
  })
  const error = companies.error ?? domain.error

  return (
    <CatalogShell
      title={domain.data?.domain.name ?? '领域公司'}
      description='仅展示已确认公司，默认按领域内去重专利数排序。'
      releaseId={companies.data?.release.releaseId}
    >
      <CatalogDomainTabs domainId={domainId} active='companies' />
      {error ? (
        <CatalogLoadError error={error} title='公司目录加载失败' />
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

export function CatalogDomainPatentsPage() {
  const { domainId } = patentsRoute.useParams()
  const { query, updateQuery } = useCatalogQueryState(
    catalogPatentListQuerySchema
  )
  const domain = useQuery({
    queryKey: ['catalog', 'domain', domainId],
    queryFn: () => catalogApi.domain(domainId),
  })
  const patents = useQuery({
    queryKey: ['catalog', 'domain-patents', domainId, query],
    queryFn: () => catalogApi.domainPatents(domainId, query),
    placeholderData: keepPreviousData,
  })
  const error = patents.error ?? domain.error

  return (
    <CatalogShell
      title={domain.data?.domain.name ?? '领域专利'}
      description='关键词仅检索标题；当前数据不包含摘要和权利要求正文。'
      releaseId={patents.data?.release.releaseId}
    >
      <CatalogDomainTabs domainId={domainId} active='patents' />
      {error ? (
        <CatalogLoadError error={error} title='专利目录加载失败' />
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
