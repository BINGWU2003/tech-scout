import type { ResearchProgressView } from '@tech-scout/contracts'
import {
  Building2,
  Check,
  CircleAlert,
  CircleDot,
  LoaderCircle,
  Pause,
  SearchX,
} from 'lucide-react'
import { companyRecords } from './company-records'
import { eventLabels, nodeLabels } from './labels'

function recordStatus(event: ResearchProgressView, active: boolean) {
  const process = event.process
  if (process?.outcome === 'failed' || event.error)
    return { label: '失败', Icon: CircleAlert, className: 'text-destructive' }
  if (process?.outcome === 'stopped' || event.kind === 'execution_stopped')
    return { label: '已停止', Icon: Pause, className: 'text-muted-foreground' }
  if (process?.outcome === 'completed') {
    // The acquisition service currently reports an unmatched result in its message.
    if (process.message === '未找到可匹配的企业登记信息')
      return {
        label: '未匹配',
        Icon: SearchX,
        className: 'text-muted-foreground',
      }
    return { label: '已完成', Icon: Check, className: 'text-primary' }
  }
  if (process?.outcome === 'running')
    return active
      ? { label: '查询中', Icon: LoaderCircle, className: 'text-primary' }
      : { label: '已停止', Icon: Pause, className: 'text-muted-foreground' }
  if (event.kind === 'node_completed')
    return { label: '已完成', Icon: Check, className: 'text-primary' }
  return {
    label: '状态更新',
    Icon: CircleDot,
    className: 'text-muted-foreground',
  }
}

export function CompanyDiscoveryRecords({
  events,
  active,
}: {
  events: ResearchProgressView[]
  active: boolean
}) {
  const records = companyRecords(events)
  if (records.length === 0)
    return (
      <p className='rounded-lg border border-dashed p-5 text-sm text-muted-foreground'>
        {active
          ? '正在准备企业查询，开始后将在这里显示记录。'
          : '暂无企业发现记录。'}
      </p>
    )
  return (
    <ol aria-label='企业发现记录' className='space-y-5'>
      {records.map((event) => {
        const process = event.process
        const { label, Icon, className } = recordStatus(event, active)
        const occurredAt = process?.occurredAt ?? event.createdAt
        return (
          <li key={event.sequence} className='space-y-3 rounded-lg border p-4'>
            <div className='flex items-start gap-2'>
              <Building2
                className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                aria-hidden='true'
              />
              <div className='min-w-0'>
                <p className='text-xs text-muted-foreground'>
                  {process?.direction ? '企业登记信息查询' : '企业发现阶段'}
                </p>
                <h3 className='mt-1 text-sm font-medium break-words'>
                  {process?.direction ||
                    nodeLabels[event.node ?? ''] ||
                    '企业发现'}
                </h3>
              </div>
            </div>
            <div className='space-y-1 border-t pt-3 text-xs'>
              <div className='flex flex-wrap justify-between gap-2'>
                <p className={`flex items-center gap-1.5 ${className}`}>
                  <Icon
                    className={`size-3.5 shrink-0 ${label === '查询中' ? 'motion-safe:animate-spin' : ''}`}
                    aria-hidden='true'
                  />
                  {label}
                </p>
                <time className='text-muted-foreground' dateTime={occurredAt}>
                  {new Date(occurredAt).toLocaleTimeString('zh-CN')}
                </time>
              </div>
              <p
                className={`break-words ${label === '失败' ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {process?.message ??
                  event.error?.message ??
                  eventLabels[event.kind] ??
                  '状态已更新'}
              </p>
              {event.error &&
                event.error.message !== process?.message &&
                process?.message && (
                  <p className='break-words text-destructive'>
                    {event.error.message}
                  </p>
                )}
              {process?.stage === 'companies' && process.completed != null && (
                <p className='text-muted-foreground'>
                  累计查询 {process.completed} 个主体
                </p>
              )}
              {process?.url && (
                <a
                  href={process.url}
                  target='_blank'
                  rel='noreferrer'
                  className='inline-block underline underline-offset-4'
                >
                  打开查询来源 ↗
                </a>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
