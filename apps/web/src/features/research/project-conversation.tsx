import { Link } from '@tanstack/react-router'
import type { ResearchWorkspace } from '@tech-scout/contracts'
import { Button } from '@/components/ui/button'

export function ProjectConversation({
  workspace,
  projectId,
  busy,
  onApply,
  onAdd,
  selectedPlan,
  dirty = false,
}: {
  workspace: ResearchWorkspace
  projectId: string
  busy: boolean
  onApply: (id: string) => void
  onAdd: (
    direction: ResearchWorkspace['selectedPlan']['directions'][number]
  ) => void
  selectedPlan: ResearchWorkspace['selectedPlan']
  dirty?: boolean
}) {
  return (
    <div aria-label='研究对话记录' className='space-y-5'>
      {workspace.messages.map((message) => (
        <article
          key={message.id}
          className={
            message.role === 'user'
              ? 'ml-auto max-w-[90%] space-y-3 rounded-2xl rounded-tr-sm bg-muted px-4 py-3 text-sm'
              : 'space-y-3 rounded-2xl border bg-muted/20 p-4 text-sm'
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
          <p className='leading-7 break-words whitespace-pre-wrap'>
            {message.text}
          </p>
          {message.plan && (
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
                    公开年份：{message.plan.from_year}–{message.plan.to_year}
                  </p>
                )}
                {message.plan.directions.map((d) => (
                  <div key={d.domain_id}>
                    <p className='font-medium'>{d.name}</p>
                    <p className='whitespace-pre-wrap text-muted-foreground'>
                      {d.explanation}
                    </p>
                    {message.recommendation && !message.outdated && (
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        className='mt-2'
                        disabled={
                          busy ||
                          selectedPlan.directions.length >= 3 ||
                          selectedPlan.directions.some(
                            (p) => p.domain_id === d.domain_id
                          )
                        }
                        onClick={() => onAdd(d)}
                      >
                        {selectedPlan.directions.some(
                          (p) => p.domain_id === d.domain_id
                        )
                          ? '已加入计划'
                          : `加入计划：${d.name}`}
                      </Button>
                    )}
                  </div>
                ))}
                {message.proposal && !message.plan.directions.length && (
                  <p>应用后将移除全部已选方向。</p>
                )}
              </div>
            </details>
          )}
          {message.proposal && message.runId && (
            <Button
              size='sm'
              variant='outline'
              disabled={busy || dirty || message.applied || message.outdated}
              onClick={() => onApply(message.runId!)}
            >
              {message.applied
                ? '已应用修改'
                : message.outdated
                  ? '建议已过期'
                  : '应用修改'}
            </Button>
          )}
          {message.hasResult && message.runId && (
            <Button asChild size='sm' variant='outline'>
              <Link
                to='/research/$projectId/$stage'
                params={{ projectId, stage: 'report' }}
                search={{ runId: message.runId }}
              >
                查看当时的结果
              </Link>
            </Button>
          )}
        </article>
      ))}
    </div>
  )
}
