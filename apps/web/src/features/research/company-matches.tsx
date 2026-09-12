import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { countryName } from './labels'
import { Pager } from './shared'
import { CompanySnapshot } from './snapshot-details'

export function CompanyMatches({ runId }: { runId: string }) {
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['research', runId, 'company-matches', page],
    queryFn: () => researchApi.companyMatches(runId, page),
  })
  return (
    <section className='space-y-4'>
      <h2 className='text-lg font-semibold'>已匹配企业</h2>

      {query.isPending && <p role='status'>正在读取匹配企业…</p>}
      {query.data?.total === 0 && (
        <p className='rounded-xl border border-dashed p-6 text-sm text-muted-foreground'>
          尚无已匹配企业，可在下方核验候选主体或生成报告。
        </p>
      )}
      {query.data?.items.map((company) => (
        <article
          key={company.id}
          className='flex items-start justify-between gap-3 rounded-xl border p-4'
        >
          <div>
            <h3 className='font-medium break-words'>{company.name}</h3>
            <p className='mt-2 text-xs text-muted-foreground'>
              {countryName(company.country)} · {company.patentCount} 条相关专利
            </p>
          </div>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setSelected(company.id)}
          >
            查看依据
          </Button>
        </article>
      ))}
      {query.data && query.data.total > 0 && (
        <Pager page={page} total={query.data.total} onChange={setPage} />
      )}
      {selected && (
        <CompanySnapshot
          runId={runId}
          companyId={selected}
          citations={[]}
          close={() => setSelected(null)}
        />
      )}
    </section>
  )
}
