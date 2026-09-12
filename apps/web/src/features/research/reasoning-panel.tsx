import type { ResearchReasoning } from '@tech-scout/contracts'
import { Brain, ChevronDown, LoaderCircle } from 'lucide-react'
import { useId, useState } from 'react'

export function ReasoningPanel({
  reasoning,
}: {
  reasoning: ResearchReasoning
}) {
  const active =
    reasoning.status === 'thinking' || reasoning.status === 'answering'
  const [expanded, setExpanded] = useState<{
    phase: string
    open: boolean
  } | null>(null)
  const phase = `${reasoning.id}:${active}`
  const open = expanded?.phase === phase ? expanded.open : active
  const contentId = useId()
  const label =
    reasoning.status === 'thinking'
      ? '正在思考'
      : reasoning.status === 'answering'
        ? '正在生成回答'
        : reasoning.status === 'interrupted'
          ? '思考已中断'
          : '思考已完成'
  return (
    <div className='rounded-xl border bg-background/60'>
      <button
        type='button'
        aria-label={`${label}，用时 ${Math.round(reasoning.durationMs / 1000)} 秒`}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setExpanded({ phase, open: !open })}
        className='flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring'
      >
        {active ? (
          <LoaderCircle
            className='size-4 motion-safe:animate-spin'
            aria-hidden='true'
          />
        ) : (
          <Brain className='size-4' aria-hidden='true' />
        )}
        <span role='status'>{label}</span>
        <span className='ml-auto'>
          {Math.round(reasoning.durationMs / 1000)} 秒
        </span>
        <ChevronDown
          className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden='true'
        />
      </button>
      {open && (
        <div
          id={contentId}
          className='space-y-2 border-t px-3 py-3 text-xs leading-6 text-muted-foreground'
        >
          <p className='break-words whitespace-pre-wrap'>
            {reasoning.text ||
              (active
                ? '正在等待模型返回内容…'
                : '本次未返回可展示的思考内容。')}
          </p>
          {reasoning.truncated && <p>思考内容较长，仅保留前 64,000 个字符。</p>}
        </div>
      )}
    </div>
  )
}
