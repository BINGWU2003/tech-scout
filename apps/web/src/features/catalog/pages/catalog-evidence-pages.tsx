import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { catalogPageQuerySchema } from '@tech-scout/contracts'
import { Skeleton } from '@/components/ui/skeleton'
import { catalogApi } from '@/lib/catalog-api'
import { CatalogCandidateDetail } from '../components/catalog-candidate-detail'
import { CatalogLoadError } from '../components/catalog-query-state'
import { CatalogShell } from '../components/catalog-shell'
import { useCatalogQueryState } from '../hooks/use-catalog-query-state'

const candidateRoute = getRouteApi(
  '/_authenticated/catalog/candidates/$candidateId'
)

export function CatalogCandidatePage() {
  const { candidateId } = candidateRoute.useParams()
  const { query, updateQuery } = useCatalogQueryState(catalogPageQuerySchema)
  const candidate = useQuery({
    queryKey: ['catalog', 'candidate', candidateId],
    queryFn: () => catalogApi.candidate(candidateId),
  })
  const evidence = useQuery({
    queryKey: ['catalog', 'candidate-evidence', candidateId, query],
    queryFn: () => catalogApi.candidateEvidence(candidateId, query),
    placeholderData: keepPreviousData,
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
        <CatalogCandidateDetail
          candidate={candidate.data.candidate}
          evidence={evidence.data}
          onPageChange={(page) => updateQuery({ page })}
        />
      ) : (
        <Skeleton className='h-96 rounded-xl' />
      )}
    </CatalogShell>
  )
}
