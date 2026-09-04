import { Link } from '@tanstack/react-router'
import { type CatalogPatentDetail as CatalogPatentDetailData } from '@tech-scout/contracts'
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
import { CatalogSourceReference } from './catalog-source-reference'

function optionalValue(value: boolean | null | number | string) {
  if (value === null || value === '') return '未知'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function MatchValues({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <div className='mb-1 text-xs text-muted-foreground'>{label}</div>
      <div className='flex flex-wrap gap-1'>
        {values.length ? (
          values.map((value) => (
            <Badge key={value} variant='secondary'>
              {value}
            </Badge>
          ))
        ) : (
          <span className='text-sm text-muted-foreground'>无</span>
        )}
      </div>
    </div>
  )
}

export function CatalogPatentDetail({
  patent,
}: {
  patent: CatalogPatentDetailData
}) {
  return (
    <div className='grid gap-4 xl:grid-cols-3'>
      <Card>
        <CardHeader>
          <CardTitle>专利信息</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='grid grid-cols-2 gap-3 text-sm'>
            <div className='col-span-2'>
              <dt className='text-muted-foreground'>专利号</dt>
              <dd className='font-mono break-all'>{patent.patentId}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>授权日期</dt>
              <dd>{patent.patentDate}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>授权年份</dt>
              <dd>{patent.grantYear}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>类型</dt>
              <dd>{optionalValue(patent.patentType)}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>WIPO kind</dt>
              <dd>{optionalValue(patent.wipoKind)}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>权利要求数</dt>
              <dd>{optionalValue(patent.numClaims)}</dd>
            </div>
            <div>
              <dt className='text-muted-foreground'>是否撤回</dt>
              <dd>{optionalValue(patent.withdrawn)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card className='xl:col-span-2'>
        <CardHeader>
          <CardTitle>领域匹配</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          {patent.domainMatches.length ? (
            patent.domainMatches.map((match) => (
              <div key={match.domainId} className='rounded-md border p-4'>
                <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
                  <Link
                    className='font-medium text-primary hover:underline'
                    to='/catalog/domains/$domainId/patents'
                    params={{ domainId: match.domainId }}
                  >
                    {match.domainName}
                  </Link>
                  <div className='flex gap-2'>
                    <Badge>得分 {match.totalScore}</Badge>
                    <Badge variant='outline'>{match.ruleVersion}</Badge>
                  </div>
                </div>
                <div className='grid gap-3 md:grid-cols-3'>
                  <MatchValues label='命中 CPC' values={match.matchedCpcs} />
                  <MatchValues
                    label='强关键词'
                    values={match.matchedStrongKeywords}
                  />
                  <MatchValues
                    label='一般关键词'
                    values={match.matchedGeneralKeywords}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>暂无领域匹配。</p>
          )}
        </CardContent>
      </Card>

      <Card className='xl:col-span-2'>
        <CardHeader>
          <CardTitle>参与方</CardTitle>
        </CardHeader>
        <CardContent>
          <div className='overflow-hidden rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>地区</TableHead>
                  <TableHead>类型</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patent.parties.length ? (
                  patent.parties.map((party) => (
                    <TableRow key={`${party.partyId}-${party.role}`}>
                      <TableCell className='font-medium'>
                        {party.name}
                      </TableCell>
                      <TableCell>{party.role}</TableCell>
                      <TableCell>
                        {[party.city, party.region, party.country]
                          .filter(Boolean)
                          .join(' / ') || '未知'}
                      </TableCell>
                      <TableCell>
                        {party.isIndividual ? '个人' : '组织'}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className='h-20 text-center'>
                      暂无参与方。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>来源追溯</CardTitle>
        </CardHeader>
        <CardContent>
          <CatalogSourceReference source={patent.source} />
        </CardContent>
      </Card>

      <Card className='xl:col-span-3'>
        <CardHeader>
          <CardTitle>分类</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-wrap gap-2'>
          {patent.classifications.length ? (
            patent.classifications.map((classification, index) => (
              <Badge
                key={`${classification.cpcGroup}-${classification.sequence ?? index}`}
                variant='outline'
              >
                {classification.cpcGroup}
              </Badge>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>暂无分类。</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
