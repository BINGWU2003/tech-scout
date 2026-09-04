import { Link } from '@tanstack/react-router'
import { type CatalogCompanyDetail as CatalogCompanyDetailData } from '@tech-scout/contracts'
import { type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

function valueOrUnknown(value: null | string) {
  return value || '未知'
}

const DETAIL_LIST_SCROLL_THRESHOLD = 4

function DetailList({
  children,
  count,
  emptyMessage,
  label,
}: {
  children: ReactNode
  count: number
  emptyMessage: string
  label: string
}) {
  if (count === 0) {
    return <p className='text-sm text-muted-foreground'>{emptyMessage}</p>
  }

  const items = <div className='space-y-3'>{children}</div>

  return count > DETAIL_LIST_SCROLL_THRESHOLD ? (
    <ScrollArea className='h-80' role='region' aria-label={label}>
      <div className='pr-4'>{items}</div>
    </ScrollArea>
  ) : (
    items
  )
}

export function CatalogCompanyDetail({
  company,
  onDomainPatentsOpen,
  onRelatedCompanyOpen,
}: {
  company: CatalogCompanyDetailData
  onDomainPatentsOpen?: (domainId: string) => void
  onRelatedCompanyOpen?: (company: {
    companyId: string
    preferredName: string
  }) => void
}) {
  return (
    <div className='grid gap-4'>
      <div className='grid gap-4 xl:grid-cols-3'>
        <div className='grid content-start gap-4 xl:grid-rows-[auto_1fr]'>
          <Card>
            <CardHeader>
              <CardTitle>公司身份</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className='grid gap-3 text-sm'>
                <div>
                  <dt className='text-muted-foreground'>法定名称</dt>
                  <dd className='font-medium'>
                    {valueOrUnknown(company.legalName)}
                  </dd>
                </div>
                <div className='grid grid-cols-2 gap-3'>
                  <div>
                    <dt className='text-muted-foreground'>国家/地区</dt>
                    <dd>{valueOrUnknown(company.country)}</dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>主体状态</dt>
                    <dd>{valueOrUnknown(company.entityStatus)}</dd>
                  </div>
                </div>
                <div>
                  <dt className='text-muted-foreground'>身份来源</dt>
                  <dd>
                    <Badge variant='outline'>{company.provider}</Badge>
                  </dd>
                </div>
                <div>
                  <dt className='text-muted-foreground'>来源记录</dt>
                  <dd className='font-mono text-xs break-all'>
                    {company.source.relativePath ?? company.source.dataset}:
                    {company.source.sourceRowNumber}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card className='xl:h-full'>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <span>外部标识</span>
                <Badge className='tabular-nums' variant='secondary'>
                  {company.externalIdentifiers.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                count={company.externalIdentifiers.length}
                emptyMessage='暂无外部标识。'
                label='公司外部标识列表'
              >
                {company.externalIdentifiers.map((identifier) => (
                  <div
                    key={identifier.identifierId}
                    className='rounded-md border p-3 text-sm'
                  >
                    <div className='font-mono break-all'>
                      {identifier.value}
                    </div>
                    <div className='text-xs text-muted-foreground'>
                      {identifier.type} · {identifier.provider}
                    </div>
                  </div>
                ))}
              </DetailList>
            </CardContent>
          </Card>
        </div>

        <Card className='flex min-h-0 flex-col xl:col-span-2'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <span>别名</span>
              <Badge className='tabular-nums' variant='secondary'>
                {company.aliases.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className='min-h-0 flex-1'>
            <DetailList
              count={company.aliases.length}
              emptyMessage='暂无别名。'
              label='公司别名列表'
            >
              {company.aliases.map((alias) => (
                <div
                  key={alias.aliasId}
                  className='rounded-md border p-3 text-sm'
                >
                  <div className='font-medium'>{alias.name}</div>
                  <div className='text-xs text-muted-foreground'>
                    {alias.type} · {alias.provider}
                  </div>
                </div>
              ))}
            </DetailList>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <CardTitle>领域专利</CardTitle>
            <Link
              className='text-sm font-medium text-primary hover:underline'
              to='/catalog/companies/$companyId/patents'
              params={{ companyId: company.companyId }}
            >
              查看全部专利
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>领域</TableHead>
                  <TableHead>专利数</TableHead>
                  <TableHead>最近授权</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {company.domainStats.length ? (
                  company.domainStats.map((domain) => (
                    <TableRow key={domain.domainId}>
                      <TableCell>
                        <Link
                          className='font-medium text-primary hover:underline'
                          to='/catalog/companies/$companyId/patents'
                          params={{ companyId: company.companyId }}
                          onClick={(event) => {
                            if (
                              !onDomainPatentsOpen ||
                              event.button !== 0 ||
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              event.altKey
                            ) {
                              return
                            }
                            event.preventDefault()
                            onDomainPatentsOpen(domain.domainId)
                          }}
                        >
                          {domain.domainName}
                        </Link>
                      </TableCell>
                      <TableCell>{domain.patentCount}</TableCell>
                      <TableCell>
                        {valueOrUnknown(domain.latestPatentDate)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className='h-20 text-center'>
                      暂无领域专利。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className='grid items-stretch gap-4 xl:grid-cols-3'>
        <Card className='h-full xl:col-span-2'>
          <CardHeader>
            <CardTitle>公司关系</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {company.relationships.length ? (
              company.relationships.map((relationship) => (
                <div
                  key={relationship.relationshipId}
                  className='flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm'
                >
                  <div>
                    {onRelatedCompanyOpen ? (
                      <button
                        className='font-medium text-primary hover:underline'
                        type='button'
                        onClick={() =>
                          onRelatedCompanyOpen(relationship.relatedCompany)
                        }
                      >
                        {relationship.relatedCompany.preferredName}
                      </button>
                    ) : (
                      <span className='font-medium'>
                        {relationship.relatedCompany.preferredName}
                      </span>
                    )}
                    <div className='text-xs text-muted-foreground'>
                      {relationship.direction === 'outgoing'
                        ? '关联至'
                        : '关联自'}{' '}
                      · {relationship.relationshipType}
                    </div>
                  </div>
                  <Badge variant='secondary'>
                    {valueOrUnknown(relationship.relationshipStatus)}
                  </Badge>
                </div>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>暂无公司关系。</p>
            )}
          </CardContent>
        </Card>

        <Card className='h-full'>
          <CardHeader>
            <CardTitle>已接受匹配</CardTitle>
          </CardHeader>
          <CardContent className='space-y-3'>
            {company.acceptedMatches.length ? (
              company.acceptedMatches.map((match) => (
                <div
                  key={match.candidateId}
                  className='rounded-md border p-3 text-sm'
                >
                  <Link
                    className='font-medium text-primary hover:underline'
                    to='/catalog/candidates/$candidateId'
                    params={{ candidateId: match.candidateId }}
                  >
                    {match.representativeName}
                  </Link>
                  <div className='text-xs text-muted-foreground'>
                    {match.matchMethod} · {match.decisionReason}
                  </div>
                </div>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>暂无已接受匹配。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
