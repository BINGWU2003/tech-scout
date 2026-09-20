import type {
  ResearchProgressView,
  ResearchWorkspace,
} from '@tech-scout/contracts'
import { Button } from '@/components/ui/button'
import { ReasoningPanel } from './reasoning-panel'
import { StreamingText } from './streaming-text'

export function ProjectConversation({
  workspace,
  busy,
  onApply,
  onAdd,
  selectedPlan,
  dirty = false,
  events = [],
}: {
  workspace: ResearchWorkspace
  busy: boolean
  onApply: (id: string) => void
  onAdd: (
    direction: ResearchWorkspace['selectedPlan']['directions'][number]
  ) => void
  selectedPlan: ResearchWorkspace['selectedPlan']
  dirty?: boolean
  events?: ResearchProgressView[]
}) {
  const live = [...events].reverse().find((event) => event.reasoning)?.reasoning
  const liveAnswer = [...events].reverse().find((event) => event.answer)?.answer
  const messages = workspace.messages.map((message) => {
    if (message.role !== 'assistant' || message.runId !== workspace.activeRunId)
      return message
    let reasoning = live ?? message.reasoning
    const previous = message.reasoning
    if (
      live &&
      previous &&
      (previous.startedAt > live.startedAt ||
        (previous.id === live.id &&
          (previous.durationMs > live.durationMs ||
            (['completed', 'interrupted'].includes(previous.status) &&
              ['thinking', 'answering'].includes(live.status)))))
    )
      reasoning = previous
    let answer = liveAnswer ?? message.answer
    const savedAnswer = message.answer
    if (
      liveAnswer &&
      savedAnswer &&
      (savedAnswer.startedAt > liveAnswer.startedAt ||
        (savedAnswer.id === liveAnswer.id &&
          savedAnswer.status !== 'streaming' &&
          liveAnswer.status === 'streaming'))
    )
      answer = savedAnswer
    return { ...message, reasoning, answer }
  })
  return (
    <div aria-label='研究对话记录' className='space-y-5'>
      {messages
        .filter(
          (message) =>
            !message.pending ||
            message.text ||
            message.plan ||
            message.reasoning ||
            message.answer
        )
        .map((message) => (
          <article
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-auto max-w-[90%] space-y-3 rounded-2xl rounded-tr-sm bg-muted px-4 py-3 text-sm'
                : 'space-y-3 px-1 py-2 text-sm'
            }
          >
            <div className='flex flex-wrap gap-2 text-xs text-muted-foreground'>
              <span>{message.role === 'user' ? '你' : 'AI'}</span>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString('zh-CN')}
              </time>
              {message.outdated && (
                <span>{message.proposal ? '建议已过期' : '已更新'}</span>
              )}
            </div>
            {message.reasoning && (
              <ReasoningPanel reasoning={message.reasoning} />
            )}
            {(message.text || message.answer?.text) && (
              <p
                role={message.failed ? 'alert' : undefined}
                className={
                  message.failed
                    ? 'rounded-lg bg-destructive/10 p-3 leading-7 break-words whitespace-pre-wrap text-destructive'
                    : 'leading-7 break-words whitespace-pre-wrap'
                }
              >
                <StreamingText
                  key={message.answer?.id ?? message.id}
                  text={message.text || message.answer?.text || ''}
                  streaming={message.answer?.status === 'streaming'}
                />
              </p>
            )}
            {message.answer?.status === 'interrupted' && (
              <p role='status' className='text-xs text-muted-foreground'>
                回答已中断，以上内容尚未完成。
              </p>
            )}
            {!message.pending && message.plan && (
              <details
                open={
                  (message.recommendation || message.proposal) &&
                  !message.outdated &&
                  !message.applied
                }
              >
                <summary className='cursor-pointer font-medium'>
                  {message.recommendation
                    ? 'AI 推荐方向'
                    : message.proposal
                      ? '查看修改建议'
                      : '查看当时的计划'}
                </summary>
                <div className='mt-3 space-y-3'>
                  {!message.recommendation && (
                    <p>
                      专利公开年份：{message.plan.from_year}–
                      {message.plan.to_year}
                    </p>
                  )}
                  {message.plan.directions.map((d) => (
                    <div
                      key={d.domain_id}
                      className='space-y-2 rounded-xl border bg-background/60 p-3'
                    >
                      <div className='flex items-start justify-between gap-3'>
                        <p className='min-w-0 font-medium break-words'>
                          {d.name}
                        </p>
                        {message.recommendation &&
                          !message.outdated &&
                          (selectedPlan.directions.some(
                            (p) => p.domain_id === d.domain_id
                          ) ? (
                            <span className='shrink-0 text-xs text-muted-foreground'>
                              已加入计划
                            </span>
                          ) : (
                            <Button
                              type='button'
                              size='sm'
                              variant='outline'
                              className='shrink-0'
                              aria-label={`加入计划：${d.name}`}
                              disabled={
                                busy || selectedPlan.directions.length >= 3
                              }
                              onClick={() => onAdd(d)}
                            >
                              加入计划
                            </Button>
                          ))}
                      </div>
                      <p className='break-words whitespace-pre-wrap text-muted-foreground'>
                        {d.explanation}
                      </p>
                    </div>
                  ))}
                  {message.recommendation &&
                    !message.outdated &&
                    selectedPlan.directions.length >= 3 && (
                      <p className='text-xs text-muted-foreground'>
                        已选满 3 个方向，可在计划中移除后替换。
                      </p>
                    )}
                  {message.proposal && !message.plan.directions.length && (
                    <p>应用后将移除全部已选方向。</p>
                  )}
                </div>
              </details>
            )}
            {message.proposal &&
              message.runId &&
              (message.applied ? (
                <p className='text-xs text-muted-foreground'>已应用修改</p>
              ) : (
                !message.outdated && (
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={busy || dirty}
                    onClick={() => onApply(message.runId!)}
                  >
                    应用修改
                  </Button>
                )
              ))}
            {message.proposal &&
              !message.applied &&
              !message.outdated &&
              dirty && (
                <p className='text-xs text-muted-foreground'>
                  应用建议前，请保存或撤销当前计划调整。
                </p>
              )}
          </article>
        ))}
    </div>
  )
}
