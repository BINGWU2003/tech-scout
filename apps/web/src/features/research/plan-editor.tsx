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
        keywords: d.keywords.map((x) => x.trim()).filter(Boolean),
        excluded_keywords: d.excluded_keywords
          .map((x) => x.trim())
          .filter(Boolean),
        cpc_prefixes: d.cpc_prefixes.map((x) => x.trim()).filter(Boolean),
      })),
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
          {run.status === 'failed' ? '手工填写研究计划' : '检查并确认研究计划'}
        </h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          确认检索后才开始采集专利和公司信息，无需预先准备数据库。
          方向之间取并集；关键词组内任选其一，关键词与 CPC 同时满足。
          关键词留空时使用方向名称，CPC 留空表示不限。 确认后本轮计划锁定。
        </p>
      </div>
      <fieldset disabled={busy} className='space-y-5'>
        <div className='grid max-w-lg grid-cols-2 gap-4'>
          <div>
            <Label htmlFor='from-year'>公开起始年份</Label>
            <Input
              id='from-year'
              type='number'
              min={run.fromYear ?? 1800}
              max={run.toYear ?? 2100}
              value={plan.from_year}
              onChange={(e) =>
                setPlan((p) => ({ ...p, from_year: Number(e.target.value) }))
              }
            />
          </div>
          <div>
            <Label htmlFor='to-year'>公开结束年份</Label>
            <Input
              id='to-year'
              type='number'
              min={run.fromYear ?? 1800}
              max={run.toYear ?? 2100}
              value={plan.to_year}
              onChange={(e) =>
                setPlan((p) => ({ ...p, to_year: Number(e.target.value) }))
              }
            />
          </div>
        </div>
        {plan.directions.map((d, i) => (
          <fieldset key={i} className='space-y-3 rounded-lg border p-4'>
            <legend className='px-2 text-sm font-semibold'>方向 {i + 1}</legend>
            <div className='grid gap-3 md:grid-cols-2'>
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
            <div className='grid gap-3 md:grid-cols-3'>
              {(['keywords', 'excluded_keywords', 'cpc_prefixes'] as const).map(
                (key, index) => (
                  <div key={key}>
                    <Label htmlFor={`${key}-${i}`}>
                      {['关键词', '排除词', 'CPC 前缀'][index]}（每行一项，最多
                      12 项）
                    </Label>
                    <Textarea
                      id={`${key}-${i}`}
                      value={d[key].join('\n')}
                      onChange={(e) =>
                        patch(i, { [key]: e.target.value.split('\n') })
                      }
                      className='mt-1 min-h-24'
                    />
                  </div>
                )
              )}
            </div>
            <div>
              <Label htmlFor={`reason-${i}`}>筛选理由</Label>
              <Textarea
                id={`reason-${i}`}
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
        {plan.risks.length > 0 && (
          <div className='rounded-lg bg-muted p-3 text-sm'>
            <p className='font-medium'>计划中的局限说明</p>
            <ul className='mt-2 list-disc space-y-1 pl-5'>
              {plan.risks.map((risk, i) => (
                <li key={i}>{risk}</li>
              ))}
            </ul>
          </div>
        )}
        <ErrorNotice error={error} />
        <Button disabled={busy}>
          {busy ? '正在提交…' : '确认检索并开始采集'}
        </Button>
      </fieldset>
    </form>
  )
}
