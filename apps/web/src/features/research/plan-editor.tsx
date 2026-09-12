import {
  researchSelectedPlanSchema,
  type ResearchWorkspace,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { useState } from 'react'
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
  onStart: () => void
  onDirty: (dirty: boolean, plan?: ResearchWorkspace['selectedPlan']) => void
  initialPlan?: ResearchWorkspace['selectedPlan']
}) {
  const plan = initialPlan ?? workspace.selectedPlan
  const [error, setError] = useState('')
  const dirty = JSON.stringify(plan) !== JSON.stringify(workspace.selectedPlan)
  const update = (next: typeof plan) => {
    onDirty(
      JSON.stringify(next) !== JSON.stringify(workspace.selectedPlan),
      next
    )
  }
  const save = async () => {
    const parsed = researchSelectedPlanSchema.safeParse(plan)
    if (!parsed.success || plan.directions.some((d) => !d.explanation.trim())) {
      setError('请检查研究计划，并填写有效的方向名称和描述。')
      return
    }
    setError('')
    try {
      await onSave(parsed.data)
      onDirty(false)
    } catch {
      /* Parent displays the request error. */
    }
  }
  return (
    <div className='space-y-5'>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className='space-y-4 rounded-xl border p-4'
        aria-label='已选研究计划'
      >
        <div>
          <h2 className='font-semibold'>已选研究计划</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            最多选择 3 个方向。保存调整后，确认计划才会开始检索。
          </p>
        </div>
        <fieldset disabled={busy} className='space-y-4'>
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
                <legend className='px-1 text-sm'>已选方向 {i + 1}</legend>
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
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  onClick={() =>
                    update({
                      ...plan,
                      directions: plan.directions.filter(
                        (p) => p.domain_id !== d.domain_id
                      ),
                    })
                  }
                >
                  移除：{d.name || `方向 ${i + 1}`}
                </Button>
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
          {error && (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          )}
          {dirty && (
            <p className='text-sm text-muted-foreground'>
              有未保存调整，请保存后继续对话或检索。
            </p>
          )}
          <div className='flex flex-wrap gap-2'>
            {dirty && (
              <Button
                type='button'
                variant='ghost'
                onClick={() => update(workspace.selectedPlan)}
              >
                撤销未保存调整
              </Button>
            )}
            <Button type='submit' variant='outline' disabled={!dirty}>
              保存调整
            </Button>
            <Button
              type='button'
              disabled={dirty || !plan.directions.length}
              onClick={onStart}
            >
              确认计划并开始检索
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  )
}
