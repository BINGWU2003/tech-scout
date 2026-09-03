import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  type CatalogCompanyListQuery,
  type CatalogCompanyPatentListQuery,
} from '@tech-scout/contracts'
import { Skeleton } from '@/components/ui/skeleton'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogCompanyDetail } from '../components/catalog-company-detail'
import { CatalogCompanyTable } from '../components/catalog-company-table'
import { CatalogPatentTable } from '../components/catalog-patent-table'
import {
  CatalogLoadError,
  CatalogUnavailableFields,
} from '../components/catalog-query-state'
import { CatalogShell } from '../components/catalog-shell'

const companiesRoute = getRouteApi('/_authenticated/catalog/companies/')
const companyRoute = getRouteApi(
  '/_authenticated/catalog/companies/$companyId/'
)
const companyPatentsRoute = getRouteApi(
  '/_authenticated/catalog/companies/$companyId/patents'
)

export function CatalogCompaniesPage() {
  const search = companiesRoute.useSearch()
  const navigate = companiesRoute.useNavigate()
  const companies = useQuery({
    queryKey: ['catalog', 'companies', search],
    queryFn: () => catalogApi.companies(search),
  })
  const updateQuery = (patch: Partial<CatalogCompanyListQuery>) =>
    navigate({ search: (previous) => ({ ...previous, ...patch }) })

  return (
    <CatalogShell
      title='公司目录'
      description='浏览当前发布中已确认的公司主体，并按名称、别名或外部标识检索。'
      releaseId={companies.data?.release.releaseId}
    >
      {companies.isError ? (
        <CatalogLoadError error={companies.error} title='公司目录加载失败' />
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

export function CatalogCompanyPage() {
  const { companyId } = companyRoute.useParams()
  const company = useQuery({
    queryKey: ['catalog', 'company', companyId],
    queryFn: () => catalogApi.company(companyId),
  })

  return (
    <CatalogShell
      title={company.data?.company.preferredName ?? '公司详情'}
      description='公司身份、领域专利、关系和已接受的实体匹配。'
      releaseId={company.data?.release.releaseId}
      backHref='/catalog/companies'
    >
      {company.isError ? (
        <CatalogLoadError error={company.error} title='公司详情加载失败' />
      ) : company.data ? (
        <>
          <CatalogCompanyDetail company={company.data.company} />
          <CatalogUnavailableFields
            fields={company.data.release.unavailableFields}
          />
        </>
      ) : (
        <Skeleton className='h-96 rounded-xl' />
      )}
    </CatalogShell>
  )
}

export function CatalogCompanyPatentsPage() {
  const { companyId } = companyPatentsRoute.useParams()
  const search = companyPatentsRoute.useSearch()
  const navigate = companyPatentsRoute.useNavigate()
  const company = useQuery({
    queryKey: ['catalog', 'company', companyId],
    queryFn: () => catalogApi.company(companyId),
  })
  const patents = useQuery({
    queryKey: ['catalog', 'company-patents', companyId, search],
    queryFn: () => catalogApi.companyPatents(companyId, search),
  })
  const updateQuery = (patch: Partial<CatalogCompanyPatentListQuery>) =>
    navigate({ search: (previous) => ({ ...previous, ...patch }) })
  const error = company.error ?? patents.error

  return (
    <CatalogShell
      title={`${company.data?.company.preferredName ?? '公司'}的专利`}
      description={
        search.domainId
          ? `已限定领域：${search.domainId}`
          : '当前发布中与该公司已接受匹配关联的全部专利。'
      }
      releaseId={patents.data?.release.releaseId}
      backHref={`/catalog/companies/${encodeURIComponent(companyId)}`}
    >
      {error ? (
        <CatalogLoadError error={error} title='公司专利加载失败' />
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
