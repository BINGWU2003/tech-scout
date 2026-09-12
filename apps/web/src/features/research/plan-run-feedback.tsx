import type {
  ResearchProgressView,
  ResearchSummaryView,
} from '@tech-scout/contracts'
import { LoaderCircle, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isExecuting } from './use-research-run'

export function PlanRunFeedback({
  run,
  events,
  disconnected,
  busy,
  readOnly,
  onAction,
}: {
  run: ResearchSummaryView
  events: ResearchProgressView[]
  disconnected: boolean
  busy: boolean
  readOnly: boolean
  onAction: (kind: 'pause' | 'retry') => void
}) {
  const active = isExecuting(run.status)
  const failed =
    run.status === 'failed' || (run.status === 'recoverable' && !!run.error)
  const stopped = run.status === 'recoverable' && !run.error
  if (readOnly || (!active && !failed && !stopped)) return null
  const reasoning = [...events]
    .reverse()
    .find((event) => event.reasoning)?.reasoning
  const label = disconnected
    ? '连接恢复中…'
    : run.status === 'queued' || !run.ready
      ? '正在准备回复…'
      : run.node && !['planner', 'plan_gate'].includes(run.node)
        ? '正在研究…'
        : reasoning?.status === 'answering' || reasoning?.status === 'completed'
          ? '正在生成回答…'
          : '正在思考…'
  return (
    <div className='flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground'>
      {active && (
        <LoaderCircle
          className='size-3.5 shrink-0 motion-safe:animate-spin'
          aria-hidden='true'
        />
      )}
      <p
        role={failed ? 'alert' : 'status'}
        className='min-w-0 flex-1 break-words'
      >
        {active
          ? label
          : failed
            ? (run.error?.message ?? '生成失败，请重试。')
            : '已停止'}
      </p>
      {active ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 shrink-0 rounded-full text-xs'
          disabled={busy}
          onClick={() => onAction('pause')}
        >
          <Square className='size-3' aria-hidden='true' />
          {busy ? '正在停止…' : '停止'}
        </Button>
      ) : failed ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 shrink-0 rounded-full text-xs'
          disabled={busy}
          onClick={() => onAction('retry')}
        >
          {busy ? '正在重试…' : '重试'}
        </Button>
      ) : null}
    </div>
  )
}
