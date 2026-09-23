import {
  researchSelectedPlanSchema,
  type ResearchWorkspace,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { Plus } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { LoadingSpinner } from '@/components/loading-spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { KeywordTags } from './keyword-tags'
import { ResearchActionBar } from './research-plan-layout'

export function SelectedPlanEditor({
  workspace,
  busy,
  onSave,
  onStart,
  onDirty,
  initialPlan,
  lockedActions,
  onGenerateKeywords,
}: {
  workspace: ResearchWorkspace
  busy: boolean
  onSave: (plan: ResearchWorkspace['selectedPlan']) => Promise<unknown>
  onStart: (plan: ResearchWorkspace['selectedPlan']) => Promise<unknown> | void
  onDirty: (dirty: boolean, plan?: ResearchWorkspace['selectedPlan']) => void
  lockedActions?: ReactNode
  initialPlan?: ResearchWorkspace['selectedPlan']
  onGenerateKeywords?: (
    direction: ResearchWorkspace['selectedPlan']['directions'][number]
  ) => Promise<string[]>
}) {
  const locked = !!workspace.executionRunId || workspace.researchCompleted
  const plan = locked
    ? workspace.selectedPlan
    : (initialPlan ?? workspace.selectedPlan)
  const isEmpty = plan.directions.length === 0
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState<'save' | 'start' | null>(null)
  const [generating, setGenerating] = useState<string | null>(null)
  const [keywordError, setKeywordError] = useState<{
    id: string
    message: string
  } | null>(null)
  const [reviewKeywords, setReviewKeywords] = useState<Set<string>>(new Set())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const sending = useRef(false)
  const dirty = JSON.stringify(plan) !== JSON.stringify(workspace.selectedPlan)
  const update = (next: typeof plan) => {
    onDirty(
      JSON.stringify(next) !== JSON.stringify(workspace.selectedPlan),
      next
    )
  }
  const save = async (start = false) => {
    if (locked || busy || sending.current) return
    const parsed = researchSelectedPlanSchema.safeParse(plan)
    if (!parsed.success || plan.directions.some((d) => !d.explanation.trim())) {
      setError('请检查方向名称、描述和关键词；关键词不能为空或超过 200 字。')
      return
    }
    if (
      start &&
      (!plan.directions.length ||
        plan.directions.some((d) => !d.keywords.length))
    ) {
      setError('每个方向至少需要一个检索关键词，补齐后才能开始研究。')
      return
    }
    setError('')
    sending.current = true
    setSubmitting(start ? 'start' : 'save')
    try {
      if (start) await onStart(parsed.data)
      else await onSave(parsed.data)
    } catch {
      /* Parent displays the request error. */
    } finally {
      sending.current = false
      setSubmitting(null)
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
          disabled={locked || busy || !!submitting || !!generating}
          className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-4'
        >
          <p className='shrink-0 text-sm text-muted-foreground'>
            已选 {plan.directions.length} / 3 个方向 ·{' '}
            {locked ? '技术方向已确认，计划只读' : '确认后开始检索'}
          </p>
          <fieldset className='shrink-0 space-y-2'>
            <legend className='mb-2 text-sm font-medium'>检索深度</legend>
            <div className='grid grid-cols-3 gap-2'>
              {(
                [
                  ['快速', 3],
                  ['标准', 5],
                  ['深入', 10],
                ] as const
              ).map(([label, pages]) => (
                <label
                  key={pages}
                  className={cn(
                    'flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-2 py-3 text-sm',
                    plan.pages_per_keyword === pages &&
                      'border-primary bg-primary/5'
                  )}
                >
                  <input
                    type='radio'
                    name='search-depth'
                    value={pages}
                    checked={plan.pages_per_keyword === pages}
                    onChange={() =>
                      update({ ...plan, pages_per_keyword: pages })
                    }
                  />
                  {label} · {pages} 页
                </label>
              ))}
            </div>
            <p className='text-xs leading-5 text-muted-foreground'>
              每个关键词最多检索 {plan.pages_per_keyword} 页，每页请求 10
              条结果。所有关键词轮流检索，不限制专利总数；确认后按下方关键词开始搜索。
            </p>
          </fieldset>
          <div
            className={cn(
              'space-y-4',
              isEmpty &&
                'flex flex-1 flex-col items-center justify-center gap-5 space-y-0 px-4 py-8 text-center'
            )}
          >
            {isEmpty && (
              <div className='max-w-xs space-y-2'>
                <h3 className='text-sm font-medium'>尚未选择技术方向</h3>
                <p className='text-sm leading-6 text-muted-foreground'>
                  从 AI 对话推荐中选择，或手动添加技术方向
                </p>
              </div>
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
                    <span className='text-sm font-medium'>
                      已选方向 {i + 1}
                    </span>
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
                    onChange={(e) => {
                      patch({ name: e.target.value })
                      setReviewKeywords((previous) =>
                        new Set(previous).add(d.domain_id)
                      )
                    }}
                  />
                  <Label htmlFor={`selected-description-${i}`}>方向描述</Label>
                  <Textarea
                    id={`selected-description-${i}`}
                    required
                    maxLength={2000}
                    value={d.explanation}
                    onChange={(e) => {
                      patch({ explanation: e.target.value })
                      setReviewKeywords((previous) =>
                        new Set(previous).add(d.domain_id)
                      )
                    }}
                  />
                  <div className='space-y-2 border-t pt-3'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <Label htmlFor={`selected-keywords-${i}`}>
                        检索关键词
                      </Label>
                      {onGenerateKeywords && !locked && (
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          disabled={!d.name.trim() || !d.explanation.trim()}
                          aria-busy={generating === d.domain_id}
                          onClick={async () => {
                            if (sending.current || locked || busy) return
                            sending.current = true
                            setGenerating(d.domain_id)
                            setKeywordError(null)
                            try {
                              const keywords = await onGenerateKeywords(d)
                              if (!mounted.current) return
                              patch({ keywords })
                              setReviewKeywords((previous) => {
                                const next = new Set(previous)
                                next.delete(d.domain_id)
                                return next
                              })
                            } catch {
                              if (mounted.current)
                                setKeywordError({
                                  id: d.domain_id,
                                  message:
                                    '关键词生成失败，原关键词已保留，请重试。',
                                })
                            } finally {
                              sending.current = false
                              if (mounted.current) setGenerating(null)
                            }
                          }}
                        >
                          {generating === d.domain_id && <LoadingSpinner />}
                          {generating === d.domain_id
                            ? '正在生成…'
                            : d.keywords.length
                              ? '重新生成'
                              : '生成关键词'}
                        </Button>
                      )}
                    </div>
                    <KeywordTags
                      id={`selected-keywords-${i}`}
                      keywords={d.keywords}
                      onChange={(keywords) => patch({ keywords })}
                    />
                    {!locked && (
                      <p className='text-xs leading-5 text-muted-foreground'>
                        {!d.keywords.length
                          ? '至少添加一个关键词才能开始研究，可手动输入或让 AI 生成。'
                          : '请检查关键词是否符合当前方向；重新生成会替换现有关键词。'}
                      </p>
                    )}
                    {reviewKeywords.has(d.domain_id) &&
                      d.keywords.length > 0 && (
                        <p
                          role='status'
                          className='text-xs text-muted-foreground'
                        >
                          方向已修改，关键词已保留，请检查是否需要调整或重新生成。
                        </p>
                      )}
                    {keywordError?.id === d.domain_id && (
                      <p role='alert' className='text-xs text-destructive'>
                        {keywordError.message}
                      </p>
                    )}
                  </div>
                </fieldset>
              )
            })}
            <Button
              type='button'
              variant='outline'
              className={cn(!isEmpty && 'ml-auto flex w-fit')}
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
              {isEmpty && <Plus aria-hidden='true' />}
              增加方向
            </Button>
            {plan.directions.length >= 3 && (
              <p className='text-xs text-muted-foreground'>
                已达 3 个方向上限，移除后可添加新方向。
              </p>
            )}
          </div>
        </fieldset>
        <ResearchActionBar>
          {locked ? (
            <div className='space-y-2'>
              <p role='status' className='text-sm text-muted-foreground'>
                技术方向已确认，计划仅供回看。如需调整方向，请新建研究。
              </p>
              {lockedActions}
            </div>
          ) : (
            <fieldset
              disabled={busy || !!submitting || !!generating}
              className='space-y-2'
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
                  <Button
                    type='button'
                    variant='outline'
                    aria-busy={submitting === 'save'}
                    onClick={() => void save()}
                  >
                    {submitting === 'save' && <LoadingSpinner />}
                    {submitting === 'save' ? '正在保存…' : '保存调整'}
                  </Button>
                )}
                <Button
                  type='button'
                  className='ml-auto'
                  aria-busy={submitting === 'start'}
                  disabled={
                    !plan.directions.length ||
                    plan.directions.some(
                      (d) => !d.keywords.some((word) => word.trim())
                    )
                  }
                  onClick={() => void save(true)}
                >
                  {submitting === 'start' && <LoadingSpinner />}
                  {submitting === 'start'
                    ? '正在提交…'
                    : dirty
                      ? '保存并开始研究'
                      : '开始研究'}
                </Button>
              </div>
            </fieldset>
          )}
        </ResearchActionBar>
      </form>
    </div>
  )
}
