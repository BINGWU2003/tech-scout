import type { ResearchReasoning } from '@tech-scout/contracts'
import { Brain, ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { StreamingText } from './streaming-text'

export function ReasoningPanel({
  reasoning,
}: {
  reasoning: ResearchReasoning
}) {
  const active = reasoning.status === 'thinking'
  const [expanded, setExpanded] = useState<{
    phase: string
    open: boolean
  } | null>(null)
  const phase = `${reasoning.id}:${active}`
  const open = expanded?.phase === phase ? expanded.open : active
  const contentId = useId()
  const label = active
    ? '正在思考'
    : reasoning.status === 'interrupted'
      ? '思考已中断'
      : '思考已完成'
  const text =
    reasoning.text ||
    (active ? '正在等待模型返回内容…' : '本次未返回可展示的思考内容。')
  return (
    <div>
      <button
        type='button'
        aria-label={`${label}，用时 ${Math.round(reasoning.durationMs / 1000)} 秒`}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setExpanded({ phase, open: !open })}
        className='flex items-center gap-2 rounded-md py-1.5 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring'
      >
        <Brain className='size-3.5' aria-hidden='true' />
        <span>{label}</span>
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
          className='mt-1 space-y-2 border-l-2 pl-3 text-xs leading-6 text-muted-foreground'
        >
          <p className='break-words whitespace-pre-wrap'>
            <StreamingText
              key={reasoning.id}
              text={text}
              streaming={active && Boolean(reasoning.text)}
            />
          </p>
          {reasoning.truncated && <p>思考内容较长，仅保留前 64,000 个字符。</p>}
        </div>
      )}
    </div>
  )
}
