import { useQuery } from '@tanstack/react-query'
import { Building2, FileText } from 'lucide-react'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { catalogApi } from '@/lib/catalog-api'
import {
  CatalogLoadError,
  CatalogUnavailableFields,
} from './catalog-query-state'

const catalogDomainNames: Record<string, string> = {
  ai_chips_edge_inference: 'AI 芯片与边缘推理',
  industrial_vision_quality_inspection: '工业视觉与 AI 质量检测',
}

export function CatalogOverview() {
  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <CatalogOverviewContent />
      </Main>
    </>
  )
}

export function CatalogOverviewContent() {
  const query = useQuery({
    queryKey: ['catalog', 'domains'],
    queryFn: catalogApi.domains,
  })

  return (
    <div className='flex flex-1 flex-col gap-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h2 className='text-2xl font-bold tracking-tight'>技术目录</h2>
          <p className='text-muted-foreground'>
            浏览当前已发布数据中的技术领域、公司和专利证据。
          </p>
          {query.data ? (
            <p className='mt-1 text-xs text-muted-foreground'>
              数据版本 {query.data.release.releaseId} · 数据截至{' '}
              {query.data.release.periodToYear} 年
            </p>
          ) : null}
        </div>
        <Button className='shrink-0' asChild variant='outline'>
          <a href='/catalog/companies'>浏览全部公司</a>
        </Button>
      </div>

      {query.isError ? (
        <CatalogLoadError error={query.error} title='技术目录加载失败' />
      ) : null}

      <div className='grid gap-4 md:grid-cols-2'>
        {query.isLoading
          ? [0, 1].map((item) => (
              <Skeleton key={item} className='h-48 rounded-xl' />
            ))
          : query.data?.items.map((domain) => {
              const localizedName = catalogDomainNames[domain.domainId]

              return (
                <a
                  key={domain.domainId}
                  href={`/catalog/domains/${encodeURIComponent(domain.domainId)}/companies`}
                  aria-label={`${localizedName ?? domain.name}${localizedName ? `（${domain.name}）` : ''} 公司`}
                  className='rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                >
                  <Card className='h-full transition-colors hover:border-primary/50 hover:bg-muted/20'>
                    <CardHeader>
                      <CardTitle className='flex min-w-0 items-baseline gap-1 text-lg'>
                        <span className='shrink-0'>
                          {localizedName ?? domain.name}
                        </span>
                        {localizedName ? (
                          <span
                            className='min-w-0 truncate text-xs font-normal text-muted-foreground'
                            title={domain.name}
                          >
                            （{domain.name}）
                          </span>
                        ) : null}
                      </CardTitle>
                      <p className='text-sm text-muted-foreground'>
                        规则版本 {domain.ruleVersion}
                      </p>
                    </CardHeader>
                    <CardContent className='grid grid-cols-2 gap-4'>
                      <div className='rounded-lg border p-3'>
                        <FileText className='mb-2 size-4 text-muted-foreground' />
                        <div className='text-2xl font-semibold tabular-nums'>
                          {domain.patentCount.toLocaleString()}
                        </div>
                        <div className='text-xs text-muted-foreground'>
                          专利
                        </div>
                      </div>
                      <div className='rounded-lg border p-3'>
                        <Building2 className='mb-2 size-4 text-muted-foreground' />
                        <div className='text-2xl font-semibold tabular-nums'>
                          {domain.companyCount.toLocaleString()}
                        </div>
                        <div className='text-xs text-muted-foreground'>
                          已确认公司
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </a>
              )
            })}
      </div>

      {query.data ? (
        <CatalogUnavailableFields
          fields={query.data.release.unavailableFields}
        />
      ) : null}
    </div>
  )
}
