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
  const [plan, setPlan] = useState(() => initialPlan ?? workspace.selectedPlan)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(plan) !== JSON.stringify(workspace.selectedPlan)
  const update = (next: typeof plan) => {
    setPlan(next)
    onDirty(
      JSON.stringify(next) !== JSON.stringify(workspace.selectedPlan),
      next
    )
  }
  const save = async () => {
    const parsed = researchSelectedPlanSchema.safeParse(plan)
    if (!parsed.success || plan.directions.some((d) => !d.explanation.trim())) {
      setError('请填写方向名称、描述和有效的公开年份。')
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
      <section
        aria-label='AI 推荐方向'
        className='space-y-3 rounded-xl border p-4'
      >
        <h2 className='font-semibold'>AI 推荐方向</h2>
        <p className='text-sm text-muted-foreground'>
          通过对话刷新候选或修改指定方向，已选计划独立保留。
        </p>
        {!workspace.candidates?.directions.length && (
          <p className='text-sm text-muted-foreground'>
            候选方向生成后会显示在这里。
          </p>
        )}
        {workspace.candidates?.directions.map((d) => {
          const included = plan.directions.some(
            (p) => p.domain_id === d.domain_id
          )
          return (
            <article
              key={d.domain_id}
              className='space-y-2 rounded-lg bg-muted/40 p-3'
            >
              <h3 className='text-sm font-medium'>{d.name}</h3>
              <p className='text-sm whitespace-pre-wrap text-muted-foreground'>
                {d.explanation}
              </p>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={busy || included || plan.directions.length >= 3}
                onClick={() =>
                  update({
                    ...plan,
                    directions: [
                      ...plan.directions,
                      {
                        ...d,
                        keywords: [],
                        excluded_keywords: [],
                        cpc_prefixes: [],
                      },
                    ],
                  })
                }
              >
                {included ? '已加入计划' : `加入计划：${d.name}`}
              </Button>
            </article>
          )
        })}
      </section>
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
              从候选方向加入，或手工增加方向。
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
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <Label htmlFor='selected-from'>公开年份从</Label>
              <Input
                id='selected-from'
                type='number'
                min={1800}
                max={new Date().getFullYear()}
                value={plan.from_year}
                onChange={(e) =>
                  update({ ...plan, from_year: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label htmlFor='selected-to'>至</Label>
              <Input
                id='selected-to'
                type='number'
                min={1800}
                max={new Date().getFullYear()}
                value={plan.to_year}
                onChange={(e) =>
                  update({ ...plan, to_year: Number(e.target.value) })
                }
              />
            </div>
          </div>
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
