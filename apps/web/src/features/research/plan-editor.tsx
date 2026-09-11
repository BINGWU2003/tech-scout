import {
  researchPlanSchema,
  type ResearchSummaryView,
  type ResearchAction,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNotice } from './shared'

type Plan = z.infer<typeof researchPlanSchema>
export function PlanEditor({
  run,
  busy,
  onSubmit,
}: {
  run: ResearchSummaryView
  busy: boolean
  onSubmit: (a: ResearchAction) => Promise<void>
}) {
  const [plan, setPlan] = useState<Plan>(
    () =>
      run.plan ?? {
        from_year: new Date().getFullYear() - 10,
        to_year: run.toYear ?? new Date().getFullYear(),
        risks: [],
        directions: [
          {
            domain_id: run.domains[0]?.id ?? 'direction-1',
            name: run.domains[0]?.name ?? run.question.slice(0, 200),
            keywords: [],
            excluded_keywords: [],
            cpc_prefixes: [],
            explanation: '人工填写研究范围',
          },
        ],
      }
  )
  const [error, setError] = useState<Error | null>(null)
  const patch = (i: number, value: Partial<Plan['directions'][number]>) =>
    setPlan((p) => ({
      ...p,
      directions: p.directions.map((d, index) =>
        index === i ? { ...d, ...value } : d
      ),
    }))
  const submit = async () => {
    const cleaned = {
      ...plan,
      directions: plan.directions.map((d) => ({
        ...d,
        keywords: [],
        excluded_keywords: [],
        cpc_prefixes: [],
      })),
    }
    if (cleaned.directions.some((d) => !d.explanation.trim())) {
      setError(new Error('请填写方向描述。'))
      return
    }
    const parsed = researchPlanSchema.safeParse(cleaned)
    if (!parsed.success) {
      setError(new Error(parsed.error.issues.map((x) => x.message).join('；')))
      return
    }
    if (
      (run.fromYear != null && parsed.data.from_year < run.fromYear) ||
      parsed.data.to_year > (run.toYear ?? new Date().getFullYear())
    ) {
      setError(new Error('公开年份不能晚于当前年份。'))
      return
    }
    setError(null)
    await onSubmit({
      action_id: createRequestId(),
      kind: 'confirm_plan',
      plan: parsed.data,
      decisions: [],
    }).catch(() => undefined)
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className='space-y-5 rounded-xl border bg-card p-5'
    >
      <div>
        <h2 className='text-lg font-semibold'>
          {run.status === 'failed' ? '手工填写技术方向' : '检查并确认技术方向'}
        </h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          调整方向名称与描述，确认后自动生成检索条件并开始搜索。确认后本轮方向锁定。
        </p>
      </div>
      <fieldset disabled={busy} className='space-y-5'>
        {plan.directions.map((d, i) => (
          <fieldset
            key={d.domain_id}
            className='space-y-3 rounded-lg border p-4'
          >
            <legend className='px-2 text-sm font-semibold'>方向 {i + 1}</legend>
            <div className='grid gap-3'>
              <div>
                <Label htmlFor={`name-${i}`}>方向名称</Label>
                <Input
                  id={`name-${i}`}
                  value={d.name}
                  maxLength={200}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <Label htmlFor={`reason-${i}`}>方向描述</Label>
              <Textarea
                id={`reason-${i}`}
                required
                value={d.explanation}
                maxLength={2000}
                onChange={(e) => patch(i, { explanation: e.target.value })}
              />
            </div>
            <Button
              type='button'
              variant='ghost'
              disabled={plan.directions.length === 1}
              onClick={() =>
                setPlan((p) => ({
                  ...p,
                  directions: p.directions.filter((_, index) => index !== i),
                }))
              }
            >
              移除此方向
            </Button>
          </fieldset>
        ))}
        <Button
          type='button'
          variant='outline'
          disabled={plan.directions.length >= 3}
          onClick={() =>
            setPlan((p) => ({
              ...p,
              directions: [
                ...p.directions,
                {
                  domain_id: `direction-${createRequestId()}`,
                  name: '',
                  keywords: [],
                  excluded_keywords: [],
                  cpc_prefixes: [],
                  explanation: '补充研究方向',
                },
              ],
            }))
          }
        >
          增加方向
        </Button>
        <ErrorNotice error={error} />
        <Button disabled={busy}>
          {busy ? '正在提交…' : '确认方向并开始检索'}
        </Button>
      </fieldset>
    </form>
  )
}
