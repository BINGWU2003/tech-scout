import type { ResearchSummaryView } from '@tech-scout/contracts'
import { Square } from 'lucide-react'
import { LoadingSpinner } from '@/components/loading-spinner'
import { Button } from '@/components/ui/button'
import { isExecuting } from './use-research-run'

export function PlanRunFeedback({
  run,
  busy,
  readOnly,
  onAction,
}: {
  run: ResearchSummaryView
  busy: boolean
  readOnly: boolean
  onAction: (kind: 'pause' | 'retry') => void
}) {
  const active = isExecuting(run.status)
  const failed =
    run.status === 'failed' || (run.status === 'recoverable' && !!run.error)
  const stopped = run.status === 'recoverable' && !run.error
  if (readOnly || (!active && !failed && !stopped)) return null
  return (
    <div className='flex items-center justify-end gap-2 px-2 pb-2 text-xs text-muted-foreground'>
      {!active && (
        <p
          role={failed ? 'alert' : 'status'}
          className='min-w-0 flex-1 break-words'
        >
          {failed ? (run.error?.message ?? '生成失败，请重试。') : '已停止'}
        </p>
      )}
      {active ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 shrink-0 rounded-full text-xs'
          disabled={busy}
          aria-busy={busy}
          onClick={() => onAction('pause')}
        >
          {busy ? (
            <LoadingSpinner size='sm' />
          ) : (
            <Square className='size-3' aria-hidden='true' />
          )}
          {busy ? '正在停止…' : '停止'}
        </Button>
      ) : failed ? (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-7 shrink-0 rounded-full text-xs'
          disabled={busy}
          aria-busy={busy}
          onClick={() => onAction('retry')}
        >
          {busy && <LoadingSpinner size='sm' />}
          {busy ? '正在重试…' : '重试'}
        </Button>
      ) : null}
    </div>
  )
}
