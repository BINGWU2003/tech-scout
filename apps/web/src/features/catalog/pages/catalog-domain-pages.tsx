import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  type CatalogCompanyListQuery,
  type CatalogPatentListQuery,
} from '@tech-scout/contracts'
import { Skeleton } from '@/components/ui/skeleton'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogCompanyTable } from '../components/catalog-company-table'
import { CatalogPatentTable } from '../components/catalog-patent-table'
import {
  CatalogLoadError,
  CatalogUnavailableFields,
} from '../components/catalog-query-state'
import { CatalogDomainTabs, CatalogShell } from '../components/catalog-shell'

const companiesRoute = getRouteApi(
  '/_authenticated/catalog/domains/$domainId/companies'
)
const patentsRoute = getRouteApi(
  '/_authenticated/catalog/domains/$domainId/patents'
)

export function CatalogDomainCompaniesPage() {
  const { domainId } = companiesRoute.useParams()
  const search = companiesRoute.useSearch()
  const navigate = companiesRoute.useNavigate()
  const domain = useQuery({
    queryKey: ['catalog', 'domain', domainId],
    queryFn: () => catalogApi.domain(domainId),
  })
  const companies = useQuery({
    queryKey: ['catalog', 'domain-companies', domainId, search],
    queryFn: () => catalogApi.domainCompanies(domainId, search),
  })
  const updateQuery = (patch: Partial<CatalogCompanyListQuery>) =>
    navigate({ search: (previous) => ({ ...previous, ...patch }) })
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
        <>
          <CatalogCompanyTable
            result={companies.data}
            query={search}
            onQueryChange={updateQuery}
          />
          <CatalogUnavailableFields
            fields={companies.data.release.unavailableFields}
          />
        </>
      ) : (
        <Skeleton className='h-96 rounded-xl' />
      )}
    </CatalogShell>
  )
}

export function CatalogDomainPatentsPage() {
  const { domainId } = patentsRoute.useParams()
  const search = patentsRoute.useSearch()
  const navigate = patentsRoute.useNavigate()
  const domain = useQuery({
    queryKey: ['catalog', 'domain', domainId],
    queryFn: () => catalogApi.domain(domainId),
  })
  const patents = useQuery({
    queryKey: ['catalog', 'domain-patents', domainId, search],
    queryFn: () => catalogApi.domainPatents(domainId, search),
  })
  const updateQuery = (patch: Partial<CatalogPatentListQuery>) =>
    navigate({ search: (previous) => ({ ...previous, ...patch }) })
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
        <>
          <CatalogPatentTable
            result={patents.data}
            query={search}
            onQueryChange={updateQuery}
          />
          <CatalogUnavailableFields
            fields={patents.data.release.unavailableFields}
          />
        </>
      ) : (
        <Skeleton className='h-96 rounded-xl' />
      )}
    </CatalogShell>
  )
}
