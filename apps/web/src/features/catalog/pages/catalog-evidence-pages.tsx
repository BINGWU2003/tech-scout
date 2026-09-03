import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogCandidateDetail } from '../components/catalog-candidate-detail'
import { CatalogPatentDetail } from '../components/catalog-patent-detail'
import {
  CatalogLoadError,
  CatalogUnavailableFields,
} from '../components/catalog-query-state'
import { CatalogShell } from '../components/catalog-shell'

const patentRoute = getRouteApi('/_authenticated/catalog/patents/$patentId')
const candidateRoute = getRouteApi(
  '/_authenticated/catalog/candidates/$candidateId'
)

export function CatalogPatentPage() {
  const { patentId } = patentRoute.useParams()
  const patent = useQuery({
    queryKey: ['catalog', 'patent', patentId],
    queryFn: () => catalogApi.patent(patentId),
  })

  return (
    <CatalogShell
      title={patent.data?.patent.title ?? '专利详情'}
      description='专利书目、分类、参与方、领域匹配原因和来源追溯。'
      releaseId={patent.data?.release.releaseId}
    >
      {patent.isError ? (
        <CatalogLoadError error={patent.error} title='专利详情加载失败' />
      ) : patent.data ? (
        <>
          <CatalogPatentDetail patent={patent.data.patent} />
          <CatalogUnavailableFields
            fields={patent.data.release.unavailableFields}
          />
        </>
      ) : (
        <Skeleton className='h-96 rounded-xl' />
      )}
    </CatalogShell>
  )
}

export function CatalogCandidatePage() {
  const { candidateId } = candidateRoute.useParams()
  const search = candidateRoute.useSearch()
  const navigate = candidateRoute.useNavigate()
  const candidate = useQuery({
    queryKey: ['catalog', 'candidate', candidateId],
    queryFn: () => catalogApi.candidate(candidateId),
  })
  const evidence = useQuery({
    queryKey: ['catalog', 'candidate-evidence', candidateId, search],
    queryFn: () => catalogApi.candidateEvidence(candidateId, search),
  })
  const error = candidate.error ?? evidence.error

  return (
    <CatalogShell
      title={candidate.data?.candidate.representativeName ?? '候选详情'}
      description='实体解析的终态决策、匹配建议和支持证据。'
      releaseId={evidence.data?.release.releaseId}
    >
      {error ? (
        <CatalogLoadError error={error} title='候选证据加载失败' />
      ) : candidate.data && evidence.data ? (
        <>
          <CatalogCandidateDetail
            candidate={candidate.data.candidate}
            evidence={evidence.data}
            onPageChange={(page) =>
              navigate({ search: (previous) => ({ ...previous, page }) })
            }
          />
          <CatalogUnavailableFields
            fields={evidence.data.release.unavailableFields}
          />
        </>
      ) : (
        <Skeleton className='h-96 rounded-xl' />
      )}
    </CatalogShell>
  )
}
