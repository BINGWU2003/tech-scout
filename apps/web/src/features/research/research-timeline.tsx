import type { ResearchProgressView } from '@tech-scout/contracts'
import {
  Check,
  ChevronDown,
  LoaderCircle,
  Search,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { eventLabels, nodeLabels } from './labels'

const stages: Record<string, string> = {
  search: '检索专利',
  patents: '采集专利详情',
  companies: '查询企业',
  snapshot: '保存研究快照',
}
const hidden = new Set([
  'model_reserved',
  'model_usage',
  'execution_stopped',
  'reasoning_progress',
  'answer_progress',
])

export function ResearchTimeline({
  events,
  active,
}: {
  events: ResearchProgressView[]
  active: boolean
}) {
  const [expanded, setExpanded] = useState<{
    active: boolean
    open: boolean
  } | null>(null)
  const open = expanded?.active === active ? expanded.open : active
  const visible = events.filter((event) => !hidden.has(event.kind))
  return (
    <section className='rounded-2xl border bg-muted/20'>
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setExpanded({ active, open: !open })}
        className='flex w-full items-center gap-2 p-4 text-left text-sm'
      >
        {active ? (
          <LoaderCircle className='size-4 animate-spin text-primary' />
        ) : (
          <Sparkles className='size-4 text-muted-foreground' />
        )}
        <span className='flex-1 font-medium'>
          {active ? '正在研究' : '研究过程与依据'}
        </span>
        <span className='text-xs text-muted-foreground'>
          {visible.length} 条记录
        </span>
        <ChevronDown
          className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <ol
          aria-label='研究过程记录'
          className='space-y-4 border-t px-4 py-5 text-sm'
        >
          {visible.length === 0 && (
            <li className='text-muted-foreground'>等待研究服务提供过程记录…</li>
          )}
          {visible.map((event) => {
            const process = event.process
            const acquisition = event.acquisition
            return (
              <li
                key={event.sequence}
                className='flex gap-3 [content-visibility:auto]'
              >
                <span className='mt-0.5 shrink-0 text-muted-foreground'>
                  {process?.stage === 'search' ? (
                    <Search className='size-4' />
                  ) : (
                    <Check className='size-4' />
                  )}
                </span>
                <div className='min-w-0 flex-1 space-y-1'>
                  <p
                    className={
                      process?.outcome === 'failed' ? 'text-destructive' : ''
                    }
                  >
                    {process?.direction && (
                      <span className='font-medium'>
                        {process.direction} ·{' '}
                      </span>
                    )}
                    {process?.message ??
                      (acquisition
                        ? (stages[acquisition.stage ?? ''] ?? '采集进度')
                        : `${nodeLabels[event.node ?? ''] ?? '研究'} · ${eventLabels[event.kind] ?? '状态更新'}`)}
                  </p>
                  {process?.keyword && (
                    <p className='text-muted-foreground'>
                      检索词：{process.keyword} · 第 {process.page} 页
                    </p>
                  )}
                  {process?.count !== undefined && (
                    <p className='text-muted-foreground'>
                      本页返回 {process.count} 条 · 累计纳入{' '}
                      {process.completed ?? 0} 条去重专利
                    </p>
                  )}
                  {acquisition?.completed != null && (
                    <p className='text-muted-foreground'>
                      {acquisition.completed}
                      {acquisition.total != null
                        ? ` / ${acquisition.total}`
                        : ''}{' '}
                      项
                    </p>
                  )}
                  {event.error && (
                    <p className='text-destructive'>{event.error.message}</p>
                  )}
                  <div className='flex flex-wrap gap-3 text-xs text-muted-foreground'>
                    <time dateTime={process?.occurredAt ?? event.createdAt}>
                      {new Date(
                        process?.occurredAt ?? event.createdAt
                      ).toLocaleTimeString('zh-CN')}
                    </time>
                    {process?.url && (
                      <a
                        href={process.url}
                        target='_blank'
                        rel='noreferrer'
                        className='underline underline-offset-4'
                      >
                        打开检索来源 ↗
                      </a>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
