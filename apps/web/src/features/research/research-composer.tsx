import { ArrowUp, Brain, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export function ResearchComposer({
  value,
  onChange,
  onSubmit,
  busy,
  blocked,
  blockedReason,
  followUp = false,
  thinking = true,
  onThinkingChange,
  autoSave = false,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  blocked?: boolean
  blockedReason?: string
  followUp?: boolean
  thinking?: boolean
  onThinkingChange?: (value: boolean) => void
  autoSave?: boolean
}) {
  return (
    <form
      className='space-y-2'
      onSubmit={(event) => {
        event.preventDefault()
        if (value.trim() && !busy && !blocked) onSubmit()
      }}
    >
      <div className='rounded-3xl border bg-muted/30 p-3 shadow-sm focus-within:ring-2 focus-within:ring-ring/30'>
        <Textarea
          aria-label={followUp ? '继续研究' : '研究需求'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={2000}
          required
          disabled={busy}
          placeholder={
            followUp
              ? '继续追问，例如：只看近五年的相关专利…'
              : '描述你想探索的技术方向…'
          }
          className='max-h-44 min-h-16 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent'
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              if (value.trim() && !busy && !blocked)
                event.currentTarget.form?.requestSubmit()
            }
          }}
        />
        <div className='flex items-center justify-between gap-3 px-1'>
          {onThinkingChange && (
            <Button
              type='button'
              size='sm'
              variant={thinking ? 'secondary' : 'ghost'}
              className='rounded-full'
              aria-pressed={thinking}
              disabled={busy}
              onClick={() => onThinkingChange(!thinking)}
            >
              <Brain className='size-4' aria-hidden='true' />
              深度思考
            </Button>
          )}
          <span className='hidden flex-1 text-xs text-muted-foreground sm:inline'>
            {blocked
              ? (blockedReason ?? '研究执行中，可先编辑；结束或停止后发送')
              : autoSave
                ? '发送时自动保存计划调整'
                : followUp
                  ? '延续当前研究 · 确认计划后开始检索'
                  : '先生成技术方向，再由你确认检索'}
          </span>
          <Button
            type='submit'
            size='icon'
            className='shrink-0 rounded-full'
            aria-label={busy ? '正在发送' : '发送研究需求'}
            disabled={!value.trim() || busy || blocked}
          >
            {busy ? <LoaderCircle className='animate-spin' /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </form>
  )
}
