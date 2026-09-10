import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import {
  type ResearchAction,
  type ResearchSummaryView,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { CompanyMatches } from './company-matches'
import { EntityReview } from './entity-review'
import { countryName, nodeLabels, statusLabels } from './labels'
import { PlanEditor } from './plan-editor'
import { ResearchComposer } from './research-composer'
import {
  researchStages,
  stageForEvent,
  stageForRun,
  type ResearchStage,
} from './research-stage'
import { ResearchTimeline } from './research-timeline'
import { ErrorNotice, Pager, ResearchShell } from './shared'
import { CompanySnapshot, PatentList, PatentSnapshot } from './snapshot-details'
import { isExecuting, useResearchRun } from './use-research-run'

function ResultPanel({ run }: { run: ResearchSummaryView }) {
  const query = useQuery({
    queryKey: ['research', run.id, 'result'],
    queryFn: () => researchApi.result(run.id),
  })
  const [company, setCompany] = useState<string | null>(null)
  const [patent, setPatent] = useState<string | null>(null)
  const selected = query.data?.companies.find((c) => c.id === company)
  return (
    <section className='space-y-4'>
      <h2 className='text-lg font-semibold'>本次研究结果</h2>
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      {query.isPending && <p role='status'>正在读取结果…</p>}
      {query.data && (
        <>
          <div className='rounded-lg bg-muted p-4 text-sm'>
            <p>
              快照 {query.data.releaseId} · {query.data.patentCount} 条去重专利
              · {query.data.companies.length} 个候选主体 ·{' '}
              {query.data.unverifiedCount} 个隔离条目
            </p>
            <p className='mt-2'>
              结果保留程序原始排序。现阶段可能包含非商业主体或宽泛硬件相关项；模型解释仅为标题/IPC
              推断，不证明产品能力。
            </p>
            {query.data.conflictCount > 0 && (
              <p className='mt-2'>
                身份依据存在 {query.data.conflictCount}{' '}
                项差异或冲突，需结合来源与观察时间复核。
              </p>
            )}
            <p className='mt-2 text-muted-foreground'>
              数据缺失：{query.data.missing.join('、')}
            </p>
          </div>
          {query.data.emptyReason && (
            <div role='status' className='rounded-xl border border-dashed p-6'>
              <h3 className='font-semibold'>本轮没有可输出的匹配名单</h3>
              <p className='mt-2 text-sm'>{query.data.emptyReason}</p>
              <p className='mt-2 text-sm text-muted-foreground'>
                系统没有自动放宽条件。可在页面下方创建新一轮研究，重新检查计划。
              </p>
            </div>
          )}
          {query.data.companies.map((c, i) => (
            <article
              key={c.id}
              className='space-y-3 rounded-xl border bg-card p-5'
            >
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <h3 className='font-semibold break-words'>
                    {i + 1}. {c.name}
                  </h3>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    企业注册地：{countryName(c.country)} ·{' '}
                    {c.identity === 'user_confirmed'
                      ? '本次人工确认身份'
                      : '来源身份匹配'}{' '}
                    · {c.patentCount} 条相关专利 · 规则分 {c.ruleScore}
                  </p>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setCompany(c.id)}
                >
                  查看快照与依据
                </Button>
              </div>
              <p className='text-sm leading-relaxed'>
                <span className='font-medium'>模型推断：</span>
                {c.explanation ?? '无解释'}
              </p>
              <div className='flex flex-wrap gap-2 text-xs'>
                <span className='py-1 text-muted-foreground'>引用专利：</span>
                {c.citationIds.map((pid) => (
                  <button
                    key={pid}
                    className='rounded border px-2 py-1 hover:bg-accent focus-visible:outline-2'
                    onClick={() => setPatent(pid)}
                  >
                    {pid}
                  </button>
                ))}
              </div>
              <p className='text-xs text-muted-foreground'>
                公开年份统计：
                {Object.entries(c.trend)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([y, n]) => `${y} 年 ${n} 件`)
                  .join(' · ')}
              </p>
            </article>
          ))}
          <details className='rounded-xl border p-4'>
            <summary className='cursor-pointer font-medium'>
              查看本次专利工作集
            </summary>
            <LazyPatents runId={run.id} />
          </details>
          {query.data.conflictCount > 0 && <ConflictList runId={run.id} />}
        </>
      )}
      {selected && (
        <CompanySnapshot
          key={selected.id}
          runId={run.id}
          companyId={selected.id}
          citations={selected.citationIds}
          close={() => setCompany(null)}
        />
      )}
      {patent && (
        <PatentSnapshot
          key={patent}
          runId={run.id}
          patentId={patent}
          close={() => setPatent(null)}
        />
      )}
    </section>
  )
}
function ConflictList({ runId }: { runId: string }) {
  const [page, setPage] = useState(1),
    [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ['research', runId, 'conflicts', page],
    queryFn: () => researchApi.conflicts(runId, page),
    enabled: open,
  })
  return (
    <details
      className='rounded-xl border p-4'
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className='cursor-pointer font-medium'>
        查看身份差异与冲突
      </summary>
      <div className='mt-3 space-y-3'>
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        {open && query.isPending && <p role='status'>读取冲突记录…</p>}
        {query.data?.items.map((c, i) => (
          <div key={i} className='rounded-md bg-muted p-3 text-sm'>
            <p className='font-medium break-all'>{c.name}</p>
            <p>{c.note}</p>
            {c.identifierType && <p>标识类型：{c.identifierType}</p>}
            {Object.entries(c.values).map(([value, ids]) => (
              <p key={value} className='text-xs break-all'>
                {value} · 证据：{ids.join('、')}
              </p>
            ))}
          </div>
        ))}
        {query.data && (
          <Pager page={page} total={query.data.total} onChange={setPage} />
        )}
      </div>
    </details>
  )
}
function LazyPatents({ runId }: { runId: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className='mt-4'>
      {show ? (
        <PatentList runId={runId} />
      ) : (
        <Button variant='outline' onClick={() => setShow(true)}>
          加载专利列表
        </Button>
      )}
    </div>
  )
}

function RunWorkspace({
  id,
  projectId,
  stage,
  readOnly = false,
}: {
  id: string
  projectId: string
  stage: ResearchStage
  readOnly?: boolean
}) {
  const navigate = useNavigate()
  const { summary, events, disconnected } = useResearchRun(id)
  const client = useQueryClient()
  const [manual, setManual] = useState(false),
    [cancelConfirm, setCancelConfirm] = useState(false)
  const actionKey = useRef<{ signature: string; input: ResearchAction } | null>(
    null
  )
  const sending = useRef(false)
  const mutation = useMutation({
    mutationFn: (input: ResearchAction) => researchApi.action(id, input),
    onSuccess: (run) => {
      client.setQueryData(['research', id, 'summary'], run)
      void client.invalidateQueries({ queryKey: ['research', id] })
      void client.invalidateQueries({
        queryKey: ['research', run.projectId, 'project'],
      })
      actionKey.current = null
      setCancelConfirm(false)
    },
  })
  const submit = async (input: ResearchAction) => {
    if (sending.current) return
    const signature = JSON.stringify({ ...input, action_id: '' })
    if (actionKey.current?.signature !== signature)
      actionKey.current = { signature, input }
    sending.current = true
    try {
      await mutation.mutateAsync(actionKey.current.input)
      const next: Partial<Record<ResearchAction['kind'], ResearchStage>> = {
        confirm_plan: 'patents',
        start_companies: 'companies',
        resolve_entities: 'report',
      }
      if (next[input.kind])
        void navigate({
          to: '/research/$projectId/$stage',
          params: { projectId, stage: next[input.kind]! },
          search: { runId: id },
        })
    } finally {
      sending.current = false
    }
  }
  const run = summary.data
  const inCurrentStage = run ? stageForRun(run) === stage : false
  return (
    <div className='space-y-6'>
      <ErrorNotice error={summary.error} retry={() => void summary.refetch()} />
      {summary.isPending && <p role='status'>正在读取运行状态…</p>}
      {run && (
        <>
          {stage === 'plan' && (
            <div className='ml-auto max-w-[90%] rounded-3xl rounded-tr-md bg-muted px-5 py-4 text-sm leading-7 break-words whitespace-pre-wrap'>
              {run.question}
            </div>
          )}
          <div className='space-y-3'>
            <div className='flex flex-wrap items-center gap-3'>
              <Badge
                variant={run.status === 'failed' ? 'destructive' : 'secondary'}
              >
                {statusLabels[run.status]}
              </Badge>
              <span className='text-sm text-muted-foreground'>
                研究快照：
                {run.releaseId ?? '采集完成后生成'}
              </span>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => void summary.refetch()}
              >
                刷新状态
              </Button>
            </div>
            {!run.ready && (
              <p role='status' className='text-sm'>
                等待研究服务接收请求，状态将自动刷新。
              </p>
            )}
            {inCurrentStage && run.acquisition && (
              <div role='status' className='rounded-lg border p-4 text-sm'>
                <p className='font-medium'>
                  数据采集：
                  {(
                    {
                      search: '检索专利',
                      patents: '读取专利详情',
                      companies: '补全企业信息',
                      snapshot: '保存研究快照',
                    } as Record<string, string>
                  )[run.acquisition.stage ?? ''] ?? '等待采集'}
                </p>
                {run.acquisition.total != null && (
                  <p>
                    {run.acquisition.completed ?? 0} / {run.acquisition.total}
                  </p>
                )}
                <p className='mt-1 text-muted-foreground'>
                  已完成的数据会保存，中断后可重试继续。
                </p>
              </div>
            )}
            {isExecuting(run.status) && disconnected && (
              <p role='status' className='text-sm text-muted-foreground'>
                实时连接中断，正在重连；当前每 5 秒读取状态。不会自动重试模型。
              </p>
            )}
            {inCurrentStage && run.error && (
              <div
                role='alert'
                className='space-y-1 rounded-lg bg-destructive/10 p-3 text-sm'
              >
                <p className='font-medium'>{run.error.message}</p>
                <p>
                  出错步骤：
                  {nodeLabels[run.error.node ?? run.node ?? ''] ?? '未知'} ·
                  错误码：{run.error.code}
                </p>
                <p>本次执行已停止，不会自动进入下一阶段。</p>
              </div>
            )}
            <ErrorNotice error={mutation.error} />
            {mutation.isError && (
              <p className='text-xs text-muted-foreground'>
                操作尚未确认成功。可刷新状态；重发相同动作会复用请求 ID。
              </p>
            )}
            {!readOnly && inCurrentStage && (
              <div className='flex flex-wrap gap-2'>
                {isExecuting(run.status) && (
                  <Button
                    variant='outline'
                    disabled={mutation.isPending}
                    onClick={() =>
                      void submit({
                        action_id: createRequestId(),
                        kind: 'pause',
                        decisions: [],
                      }).catch(() => undefined)
                    }
                  >
                    暂停本轮研究
                  </Button>
                )}
                {['failed', 'recoverable'].includes(run.status) && (
                  <Button
                    disabled={mutation.isPending}
                    onClick={() =>
                      void submit({
                        action_id: createRequestId(),
                        kind: 'retry',
                        decisions: [],
                      }).catch(() => undefined)
                    }
                  >
                    手动重试当前步骤
                  </Button>
                )}
                {run.status === 'failed' &&
                  (run.error?.node ?? run.node) === 'planner' &&
                  !manual && (
                    <Button variant='outline' onClick={() => setManual(true)}>
                      改为手工填写计划
                    </Button>
                  )}
                {!['completed', 'empty', 'cancelled'].includes(run.status) && (
                  <Button
                    variant='outline'
                    disabled={mutation.isPending}
                    onClick={() => setCancelConfirm(true)}
                  >
                    取消本轮研究
                  </Button>
                )}
              </div>
            )}
            {cancelConfirm && (
              <div className='rounded-lg bg-muted p-3 text-sm'>
                <p>取消后本轮不能继续执行，已有记录和已发生费用保留。</p>
                <div className='mt-2 flex gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={mutation.isPending}
                    onClick={() => setCancelConfirm(false)}
                  >
                    返回
                  </Button>
                  <Button
                    size='sm'
                    variant='destructive'
                    disabled={mutation.isPending}
                    onClick={() =>
                      void submit({
                        action_id: createRequestId(),
                        kind: 'cancel',
                        decisions: [],
                      }).catch(() => undefined)
                    }
                  >
                    确认取消本轮
                  </Button>
                </div>
              </div>
            )}
          </div>
          <ResearchTimeline
            key={stage}
            events={(events.data ?? []).filter(
              (event) => stageForEvent(event) === stage
            )}
            active={inCurrentStage && isExecuting(run.status)}
          />
          <ErrorNotice
            error={events.error}
            retry={() => void events.refetch()}
          />
          {stage === 'plan' &&
            !readOnly &&
            (run.status === 'awaiting_plan' ||
              (manual &&
                run.status === 'failed' &&
                (run.error?.node ?? run.node) === 'planner')) && (
              <PlanEditor
                run={run}
                busy={mutation.isPending}
                onSubmit={submit}
              />
            )}
          {stage === 'plan' &&
            (run.confirmedPlan || (readOnly && run.plan)) && (
              <details className='rounded-xl border p-4'>
                <summary className='cursor-pointer font-medium'>
                  {run.confirmedPlan ? '已确认的检索计划' : '本轮生成的计划'}
                </summary>
                <div className='mt-3 space-y-3 text-sm'>
                  <p>
                    公开年份：{(run.confirmedPlan ?? run.plan)!.from_year}–
                    {(run.confirmedPlan ?? run.plan)!.to_year}
                  </p>
                  {(run.confirmedPlan ?? run.plan)!.directions.map((d, i) => (
                    <div key={i}>
                      <p className='font-medium'>{d.name}</p>
                      <p>
                        关键词：{d.keywords.join('、') || '不限'}；IPC：
                        {d.cpc_prefixes.join('、') || '不限'}
                      </p>
                      <p>排除词：{d.excluded_keywords.join('、') || '无'}</p>
                      <p className='text-muted-foreground'>{d.explanation}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          {stage === 'plan' && run.confirmedPlan && (
            <Button asChild variant='outline'>
              <Link
                to='/research/$projectId/$stage'
                params={{ projectId, stage: 'patents' }}
                search={{ runId: id }}
              >
                查看专利检索 →
              </Link>
            </Button>
          )}
          {stage === 'patents' && (
            <>
              {run.hasPatents ? (
                <section className='space-y-4'>
                  <h2 className='text-lg font-semibold'>本轮专利</h2>
                  <PatentList runId={id} />
                </section>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {run.confirmedPlan
                    ? '专利采集完成后，列表将在这里显示。'
                    : '请先在技术方向与计划页确认检索计划。'}
                </p>
              )}
              {!readOnly && run.status === 'awaiting_companies' && (
                <div className='rounded-2xl border bg-muted/20 p-5'>
                  <p className='mb-3 text-sm'>
                    专利采集已完成。查看结果后，可开始查询相关企业。
                  </p>
                  <Button
                    disabled={mutation.isPending}
                    onClick={() =>
                      void submit({
                        action_id: createRequestId(),
                        kind: 'start_companies',
                        decisions: [],
                      }).catch(() => undefined)
                    }
                  >
                    开始企业发现 →
                  </Button>
                </div>
              )}
              {run.hasCompanies && (
                <Button asChild variant='outline'>
                  <Link
                    to='/research/$projectId/$stage'
                    params={{ projectId, stage: 'companies' }}
                    search={{ runId: id }}
                  >
                    查看企业发现与核验 →
                  </Link>
                </Button>
              )}
            </>
          )}
          {stage === 'companies' && (
            <>
              {run.hasCompanies ? (
                <>
                  <CompanyMatches runId={id} />
                  <EntityReview
                    key={`${run.id}-${run.status}-${readOnly}`}
                    run={run}
                    busy={mutation.isPending}
                    onSubmit={submit}
                    readOnly={readOnly}
                  />
                </>
              ) : (
                <p className='rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>
                  {inCurrentStage && isExecuting(run.status)
                    ? '正在查询企业信息，完成后会显示匹配结果与待核验主体。'
                    : '请先在专利检索页点击“开始企业发现”。'}
                </p>
              )}
              {run.hasResult && (
                <Button asChild variant='outline'>
                  <Link
                    to='/research/$projectId/$stage'
                    params={{ projectId, stage: 'report' }}
                    search={{ runId: id }}
                  >
                    查看研究报告 →
                  </Link>
                </Button>
              )}
            </>
          )}
          {stage === 'report' &&
            (run.hasResult ? (
              <ResultPanel run={run} />
            ) : (
              <p className='rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>
                {inCurrentStage && isExecuting(run.status)
                  ? '正在分析证据并生成报告，完成后将在这里显示。'
                  : '请先在企业发现与核验页确认主体并生成报告。'}
              </p>
            ))}
          {!inCurrentStage && !run.hasResult && (
            <Button asChild variant='outline'>
              <Link
                to='/research/$projectId/$stage'
                params={{ projectId, stage: stageForRun(run) }}
                search={{ runId: id }}
              >
                前往{researchStages[stageForRun(run)].title}
              </Link>
            </Button>
          )}
        </>
      )}
    </div>
  )
}

export function ResearchEntry({
  projectId,
  runId,
}: {
  projectId: string
  runId?: string
}) {
  const project = useQuery({
    queryKey: ['research', projectId, 'project'],
    queryFn: () => researchApi.project(projectId),
  })
  const runs = project.data?.runs ?? []
  const selected = runId
    ? runs.find((run) => run.id === runId)
    : runs[runs.length - 1]
  const summary = useQuery({
    queryKey: ['research', selected?.id, 'summary'],
    queryFn: () => researchApi.summary(selected!.id),
    enabled: Boolean(selected),
  })
  if (summary.data)
    return (
      <Navigate
        to='/research/$projectId/$stage'
        params={{ projectId, stage: stageForRun(summary.data) }}
        search={{ runId: selected!.id }}
        replace
      />
    )
  return (
    <ResearchShell>
      <ErrorNotice
        error={project.error ?? summary.error}
        retry={() => {
          void project.refetch()
          if (selected) void summary.refetch()
        }}
      />
      <p role='status'>
        {project.data && !selected
          ? '此轮次不存在，请从左侧重新打开项目。'
          : '正在打开研究…'}
      </p>
    </ResearchShell>
  )
}

export function ResearchDetail({
  projectId,
  runId,
  stage,
}: {
  projectId: string
  runId?: string
  stage: ResearchStage
}) {
  return (
    <ProjectWorkspace
      key={projectId}
      projectId={projectId}
      runId={runId}
      stage={stage}
    />
  )
}

function ProjectWorkspace({
  projectId,
  runId,
  stage,
}: {
  projectId: string
  runId?: string
  stage: ResearchStage
}) {
  const project = useQuery({
    queryKey: ['research', projectId, 'project'],
    queryFn: () => researchApi.project(projectId),
    refetchInterval: 5000,
  })
  const runs = project.data?.runs ?? []
  const latest = runs[runs.length - 1]
  const selected = runId ? runs.find((run) => run.id === runId) : latest
  const readOnly = selected?.id !== latest?.id
  const current = useQuery({
    queryKey: ['research', latest?.id, 'summary'],
    queryFn: () => researchApi.summary(latest!.id),
    enabled: Boolean(latest),
    refetchInterval: 5000,
  })
  const [question, setQuestion] = useState('')
  const requestKey = useRef({ signature: '', id: createRequestId() })
  const client = useQueryClient(),
    navigate = useNavigate()
  const create = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify([question.trim(), latest?.id])
      if (requestKey.current.signature !== signature)
        requestKey.current = { signature, id: createRequestId() }
      return researchApi.newRun(projectId, {
        question: question.trim(),
        requestKey: requestKey.current.id,
        parentRunId: latest?.id,
      })
    },
    onSuccess: async (run) => {
      setQuestion('')
      client.setQueryData(['research', run.id, 'summary'], run)
      await client.invalidateQueries({
        queryKey: ['research', projectId, 'project'],
      })
      void navigate({
        to: '/research/$projectId/$stage',
        params: { projectId, stage: 'plan' },
        search: { runId: run.id },
      })
    },
    onError: () => {
      void project.refetch()
    },
  })
  const blocked =
    !current.data || current.isError || isExecuting(current.data.status)
  return (
    <ResearchShell
      key={`${selected?.id}-${stage}`}
      title={project.data?.title ?? '研究工作台'}
      navigation={
        <div className='mx-auto max-w-4xl space-y-3'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <label className='flex min-w-0 items-center gap-2 text-xs text-muted-foreground'>
              研究轮次
              <select
                aria-label='研究轮次'
                className='max-w-56 rounded-md border bg-background px-2 py-1.5 text-foreground'
                value={selected?.id ?? ''}
                onChange={(event) =>
                  void navigate({
                    to: '/research/$projectId/$stage',
                    params: { projectId, stage },
                    search: { runId: event.target.value },
                  })
                }
              >
                {!selected && <option value=''>请选择轮次</option>}
                {runs.map((run, index) => (
                  <option key={run.id} value={run.id}>
                    第 {index + 1} 轮 · {statusLabels[run.status]}
                    {run.id === latest?.id ? '（最新）' : ''}
                  </option>
                ))}
              </select>
            </label>
            {(stage !== 'plan' || readOnly) && latest && (
              <Button asChild variant='ghost' size='sm'>
                <Link
                  to='/research/$projectId/$stage'
                  params={{ projectId, stage: 'plan' }}
                  search={{ runId: latest.id }}
                >
                  调整研究
                </Link>
              </Button>
            )}
          </div>
          <nav
            aria-label='研究流程'
            className='grid grid-cols-2 gap-2 sm:grid-cols-4'
          >
            {(
              Object.entries(researchStages) as [
                ResearchStage,
                { title: string },
              ][]
            ).map(([key, item], index) => (
              <Link
                key={key}
                to='/research/$projectId/$stage'
                params={{ projectId, stage: key }}
                search={{ runId: selected?.id }}
                aria-current={stage === key ? 'page' : undefined}
                className={`rounded-lg px-3 py-2.5 text-center text-xs transition-colors sm:text-sm ${stage === key ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground hover:bg-muted'}`}
              >
                {index + 1}. {item.title}
              </Link>
            ))}
          </nav>
        </div>
      }
      composer={
        stage === 'plan' &&
        selected &&
        !readOnly && (
          <ResearchComposer
            value={question}
            onChange={setQuestion}
            onSubmit={() => create.mutate()}
            busy={create.isPending}
            blocked={blocked}
            followUp
            error={create.error ?? current.error}
          />
        )
      }
    >
      <div>
        <h1 className='text-2xl font-semibold tracking-tight'>
          {researchStages[stage].title}
        </h1>
        <p className='mt-2 text-sm leading-6 text-muted-foreground'>
          {researchStages[stage].description}
        </p>
      </div>
      <ErrorNotice error={project.error} retry={() => void project.refetch()} />
      {project.isPending && <p role='status'>正在读取研究…</p>}
      {project.data && !selected && (
        <p role='alert'>此轮次不属于当前项目，请在顶部选择已有轮次。</p>
      )}
      {readOnly && selected && (
        <p className='rounded-lg bg-muted p-3 text-sm text-muted-foreground'>
          正在查看历史轮次，仅供回看。调整研究将从最新轮次继承条件。
        </p>
      )}
      {selected && (
        <RunWorkspace
          key={`${selected.id}-${stage}`}
          id={selected.id}
          projectId={projectId}
          stage={stage}
          readOnly={readOnly}
        />
      )}
    </ResearchShell>
  )
}
