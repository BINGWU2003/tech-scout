import {
  researchSelectedPlanSchema,
  type ResearchWorkspace,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function SelectedPlanEditor({
  workspace,
  busy,
  onSave,
  onStart,
  onDirty,
  initialPlan,
}: {
  workspace: ResearchWorkspace
  busy: boolean
  onSave: (plan: ResearchWorkspace['selectedPlan']) => Promise<unknown>
  onStart: (plan: ResearchWorkspace['selectedPlan']) => Promise<unknown> | void
  onDirty: (dirty: boolean, plan?: ResearchWorkspace['selectedPlan']) => void
  initialPlan?: ResearchWorkspace['selectedPlan']
}) {
  const plan = initialPlan ?? workspace.selectedPlan
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const sending = useRef(false)
  const dirty = JSON.stringify(plan) !== JSON.stringify(workspace.selectedPlan)
  const update = (next: typeof plan) => {
    onDirty(
      JSON.stringify(next) !== JSON.stringify(workspace.selectedPlan),
      next
    )
  }
  const save = async (start = false) => {
    if (busy || sending.current) return
    const parsed = researchSelectedPlanSchema.safeParse(plan)
    if (!parsed.success || plan.directions.some((d) => !d.explanation.trim())) {
      setError('请检查研究计划，并填写有效的方向名称和描述。')
      return
    }
    setError('')
    sending.current = true
    setSubmitting(true)
    try {
      if (start) await onStart(parsed.data)
      else await onSave(parsed.data)
    } catch {
      /* Parent displays the request error. */
    } finally {
      sending.current = false
      setSubmitting(false)
    }
  }
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className='flex min-h-0 flex-1 flex-col'
        aria-label='已选研究计划'
      >
        <fieldset
          disabled={busy || submitting}
          className='min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4'
        >
          <p className='text-sm text-muted-foreground'>
            已选 {plan.directions.length} / 3 个方向 · 确认后开始检索
          </p>
          {!plan.directions.length && (
            <p className='text-sm text-muted-foreground'>
              从 AI 对话中的推荐加入，或手工增加方向。
            </p>
          )}
          {plan.directions.map((d, i) => {
            const patch = (value: Partial<typeof d>) =>
              update({
                ...plan,
                directions: plan.directions.map((p, index) =>
                  index === i ? { ...p, ...value } : p
                ),
              })
            return (
              <fieldset
                key={d.domain_id}
                className='space-y-3 rounded-lg border p-3'
              >
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-sm font-medium'>已选方向 {i + 1}</span>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    aria-label={`移除：${d.name || `方向 ${i + 1}`}`}
                    className='text-muted-foreground hover:text-destructive'
                    onClick={() =>
                      update({
                        ...plan,
                        directions: plan.directions.filter(
                          (p) => p.domain_id !== d.domain_id
                        ),
                      })
                    }
                  >
                    移除
                  </Button>
                </div>
                <Label htmlFor={`selected-name-${i}`}>方向名称</Label>
                <Input
                  id={`selected-name-${i}`}
                  required
                  maxLength={200}
                  value={d.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
                <Label htmlFor={`selected-description-${i}`}>方向描述</Label>
                <Textarea
                  id={`selected-description-${i}`}
                  required
                  maxLength={2000}
                  value={d.explanation}
                  onChange={(e) => patch({ explanation: e.target.value })}
                />
              </fieldset>
            )
          })}
          <Button
            type='button'
            variant='outline'
            disabled={plan.directions.length >= 3}
            onClick={() =>
              update({
                ...plan,
                directions: [
                  ...plan.directions,
                  {
                    domain_id: `direction-${createRequestId()}`,
                    name: '',
                    explanation: '',
                    keywords: [],
                    excluded_keywords: [],
                    cpc_prefixes: [],
                  },
                ],
              })
            }
          >
            增加方向
          </Button>
          {plan.directions.length >= 3 && (
            <p className='text-xs text-muted-foreground'>
              已达 3 个方向上限，移除后可添加新方向。
            </p>
          )}
        </fieldset>
        <fieldset
          disabled={busy || submitting}
          className='shrink-0 space-y-3 border-t bg-background p-4'
        >
          {error && (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          )}
          {dirty && (
            <p className='text-sm text-muted-foreground'>
              有未保存调整，开始研究或发送消息时将自动保存。
            </p>
          )}
          <div className='flex flex-wrap items-center gap-2'>
            {dirty && (
              <Button
                type='button'
                variant='ghost'
                onClick={() => update(workspace.selectedPlan)}
              >
                撤销调整
              </Button>
            )}
            {dirty && (
              <Button type='submit' variant='outline'>
                保存调整
              </Button>
            )}
            <Button
              type='button'
              className='ml-auto'
              disabled={!plan.directions.length}
              onClick={() => void save(true)}
            >
              {submitting ? '正在提交…' : dirty ? '保存并开始研究' : '开始研究'}
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  )
}
