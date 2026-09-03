import { type CatalogCompanyDetail as CatalogCompanyDetailData } from '@tech-scout/contracts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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

export function CatalogCompanyDetail({
  company,
}: {
  company: CatalogCompanyDetailData
}) {
  return (
    <div className='grid gap-4 xl:grid-cols-3'>
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

      <Card>
        <CardHeader>
          <CardTitle>别名</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          {company.aliases.length ? (
            company.aliases.map((alias) => (
              <div
                key={alias.aliasId}
                className='rounded-md border p-3 text-sm'
              >
                <div className='font-medium'>{alias.name}</div>
                <div className='text-xs text-muted-foreground'>
                  {alias.type} · {alias.provider}
                </div>
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>暂无别名。</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>外部标识</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          {company.externalIdentifiers.length ? (
            company.externalIdentifiers.map((identifier) => (
              <div
                key={identifier.identifierId}
                className='rounded-md border p-3 text-sm'
              >
                <div className='font-mono break-all'>{identifier.value}</div>
                <div className='text-xs text-muted-foreground'>
                  {identifier.type} · {identifier.provider}
                </div>
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>暂无外部标识。</p>
          )}
        </CardContent>
      </Card>

      <Card className='xl:col-span-3'>
        <CardHeader>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <CardTitle>领域专利</CardTitle>
            <a
              className='text-sm font-medium text-primary hover:underline'
              href={`/catalog/companies/${encodeURIComponent(company.companyId)}/patents`}
            >
              查看全部专利
            </a>
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
                        <a
                          className='font-medium text-primary hover:underline'
                          href={`/catalog/companies/${encodeURIComponent(company.companyId)}/patents?domainId=${encodeURIComponent(domain.domainId)}`}
                        >
                          {domain.domainName}
                        </a>
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

      <Card className='xl:col-span-2'>
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
                  <a
                    className='font-medium text-primary hover:underline'
                    href={`/catalog/companies/${encodeURIComponent(relationship.relatedCompany.companyId)}`}
                  >
                    {relationship.relatedCompany.preferredName}
                  </a>
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

      <Card>
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
                <a
                  className='font-medium text-primary hover:underline'
                  href={`/catalog/candidates/${encodeURIComponent(match.candidateId)}`}
                >
                  {match.representativeName}
                </a>
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
  )
}
