import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import {
  researchSelectedPlanSchema,
  type ResearchProgressView,
  type ResearchAction,
  type ResearchSummaryView,
  type ResearchWorkspace,
  type ResearchWorkspaceAction,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resetApiErrors } from '@/lib/api-error-notifications'
import { researchApi } from '@/lib/research-api'
import { CompanyMatches } from './company-matches'
import { EntityReview } from './entity-review'
import { countryName, nodeLabels, statusLabels } from './labels'
import { PatentWorkspace } from './patent-workspace'
import { SelectedPlanEditor } from './plan-editor'
import { PlanRunFeedback } from './plan-run-feedback'
import { ProjectConversation } from './project-conversation'
import { ResearchComposer } from './research-composer'
import { ResearchPlanLayout } from './research-plan-layout'
import {
  researchStages,
  stageForEvent,
  stageForRun,
  type ResearchStage,
} from './research-stage'
import { ResearchTimeline } from './research-timeline'
import { Pager, ResearchShell } from './shared'
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
              <h3 className='font-semibold'>本次没有可输出的匹配名单</h3>
              <p className='mt-2 text-sm'>{query.data.emptyReason}</p>
              <p className='mt-2 text-sm text-muted-foreground'>
                可点击“调整研究”，在对话中修改要求并确认计划。
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
function PreviousResult({ id }: { id: string }) {
  const summary = useQuery({
    queryKey: ['research', id, 'summary'],
    queryFn: () => researchApi.summary(id),
  })
  return (
    <section className='space-y-4'>
      <p role='status' className='rounded-lg bg-muted p-3 text-sm'>
        新结果尚未生成，以下结果基于此前确认的计划。
      </p>

      {summary.data && <ResultPanel key={id} run={summary.data} />}
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
  composer,
  directions,
  conversation,
  previousResultId,
}: {
  id: string
  projectId: string
  stage: ResearchStage
  readOnly?: boolean
  composer?: ReactNode
  directions?: ReactNode
  conversation?: (events: ResearchProgressView[]) => ReactNode
  previousResultId?: string | null
}) {
  const navigate = useNavigate()
  const { summary, events, disconnected } = useResearchRun(id)
  const client = useQueryClient()
  const [cancelConfirm, setCancelConfirm] = useState(false)
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
      void client.invalidateQueries({
        queryKey: ['research', run.projectId, 'workspace'],
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
  const statusContent = run && (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <Badge variant={run.status === 'failed' ? 'destructive' : 'secondary'}>
          {statusLabels[run.status]}
        </Badge>
        {stage !== 'patents' && (
          <span className='text-sm text-muted-foreground'>
            研究快照：
            {run.releaseId ?? '采集完成后生成'}
          </span>
        )}
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            resetApiErrors()
            void summary.refetch()
          }}
        >
          刷新状态
        </Button>
      </div>
      {!run.ready && (
        <p role='status' className='text-sm'>
          等待研究服务接收请求，状态将自动刷新。
        </p>
      )}
      {stage !== 'patents' && inCurrentStage && run.acquisition && (
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
            {nodeLabels[run.error.node ?? run.node ?? ''] ?? '未知'} · 错误码：
            {run.error.code}
          </p>
          <p>本次执行已停止，不会自动进入下一阶段。</p>
        </div>
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
              暂停本次研究
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
          {!['completed', 'empty', 'cancelled'].includes(run.status) && (
            <Button
              variant='outline'
              disabled={mutation.isPending}
              onClick={() => setCancelConfirm(true)}
            >
              取消本次研究
            </Button>
          )}
        </div>
      )}
      {cancelConfirm && (
        <div className='rounded-lg bg-muted p-3 text-sm'>
          <p>取消后本次不能继续执行，已有记录和已发生费用保留。</p>
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
              确认取消执行
            </Button>
          </div>
        </div>
      )}
    </div>
  )
  const timeline = run && (
    <>
      <ResearchTimeline
        key={stage}
        events={(events.data ?? []).filter(
          (event) => stageForEvent(event) === stage
        )}
        active={inCurrentStage && isExecuting(run.status)}
      />
    </>
  )
  if (stage === 'plan')
    return (
      <div className='flex min-h-0 flex-1 flex-col'>
        {summary.isPending && <p role='status'>正在读取运行状态…</p>}
        {run && (
          <ResearchPlanLayout
            directions={directions}
            conversation={conversation?.(events.data ?? [])}
            composer={
              <>
                <PlanRunFeedback
                  run={run}
                  events={events.data ?? []}
                  disconnected={disconnected}
                  busy={mutation.isPending}
                  readOnly={readOnly}
                  onAction={(kind) =>
                    void submit({
                      action_id: createRequestId(),
                      kind,
                      decisions: [],
                    }).catch(() => undefined)
                  }
                />
                {composer}
              </>
            }
          />
        )}
      </div>
    )
  if (stage === 'patents')
    return (
      <div className='flex min-h-0 flex-1 flex-col'>
        {summary.isPending && <p role='status'>正在读取运行状态…</p>}
        {summary.isError && (
          <p role='alert'>运行状态加载失败，请刷新页面重试。</p>
        )}
        {run && (
          <PatentWorkspace
            run={run}
            events={(events.data ?? []).filter(
              (event) => stageForEvent(event) === 'patents'
            )}
            active={inCurrentStage && isExecuting(run.status)}
            eventsError={events.isError}
            onRetryEvents={() => void events.refetch()}
            controls={statusContent}
            actions={
              <>
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
            }
          />
        )}
      </div>
    )
  return (
    <div className='space-y-6'>
      {summary.isPending && <p role='status'>正在读取运行状态…</p>}
      {run && (
        <>
          {statusContent}
          {timeline}
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
            ) : previousResultId ? (
              <PreviousResult id={previousResultId} />
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
        params={{
          projectId,
          stage: runId ? stageForRun(summary.data) : 'plan',
        }}
        search={{ runId: selected!.id }}
        replace
      />
    )
  return (
    <ResearchShell>
      <p role='status'>
        {project.data && !selected
          ? '此记录不存在，请从左侧重新打开项目。'
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
  const current = useQuery({
    queryKey: ['research', latest?.id, 'summary'],
    queryFn: () => researchApi.summary(latest!.id),
    enabled: Boolean(latest),
    refetchInterval: 5000,
  })
  const workspace = useQuery({
    queryKey: ['research', projectId, 'workspace'],
    queryFn: () => researchApi.workspace(projectId),
    refetchInterval: 5000,
  })
  const selectedId =
    stage === 'plan'
      ? latest?.id
      : (runId ?? workspace.data?.executionRunId ?? latest?.id)
  const selected = runs.find((run) => run.id === selectedId)
  const readOnly =
    stage !== 'plan' &&
    selected?.id !== (workspace.data?.executionRunId ?? latest?.id)
  const [draft, setDraft] = useState<{
    revision: number
    baseline: ResearchWorkspace['selectedPlan']
    plan: ResearchWorkspace['selectedPlan']
  } | null>(null)
  const dirty = draft !== null
  const editPlan = (
    dirty: boolean,
    plan?: ResearchWorkspace['selectedPlan']
  ) => {
    if (!dirty) setDraft(null)
    else if (plan && workspace.data) {
      const current = workspace.data
      setDraft((previous) => ({
        revision: previous?.revision ?? current.revision,
        baseline: previous?.baseline ?? current.selectedPlan,
        plan,
      }))
    }
  }
  const editorWorkspace =
    workspace.data && draft
      ? {
          ...workspace.data,
          revision: draft.revision,
          selectedPlan: draft.baseline,
        }
      : workspace.data

  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState(true)
  const requestKey = useRef({ signature: '', id: createRequestId() })
  const client = useQueryClient(),
    navigate = useNavigate()
  const create = useMutation({
    mutationFn: async () => {
      if (draft) await savePlan(draft.plan)
      const signature = JSON.stringify([question.trim(), latest?.id, thinking])
      if (requestKey.current.signature !== signature)
        requestKey.current = { signature, id: createRequestId() }
      return researchApi.newRun(projectId, {
        question: question.trim(),
        requestKey: requestKey.current.id,
        parentRunId: latest?.id,
        thinking,
      })
    },
    onSuccess: async (run) => {
      setQuestion('')
      void client.invalidateQueries({
        queryKey: ['research', projectId, 'workspace'],
      })
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
  const workspaceKey = useRef<{
    signature: string
    input: ResearchWorkspaceAction
  } | null>(null)
  const change = useMutation({
    mutationFn: (input: ResearchWorkspaceAction) =>
      researchApi.workspaceAction(projectId, input),
    onSuccess: async (data, input) => {
      client.setQueryData(['research', projectId, 'workspace'], data)
      editPlan(false)
      workspaceKey.current = null
      await client.invalidateQueries({
        queryKey: ['research', projectId, 'project'],
      })
      if (input.kind === 'start_search' && data.activeRunId)
        void navigate({
          to: '/research/$projectId/$stage',
          params: { projectId, stage: 'patents' },
          search: { runId: data.activeRunId },
        })
    },
  })
  const updateWorkspace = (input: ResearchWorkspaceAction) => {
    const signature = JSON.stringify({ ...input, requestKey: '' })
    if (workspaceKey.current?.signature !== signature)
      workspaceKey.current = { signature, input }
    return change.mutateAsync(workspaceKey.current.input)
  }
  const blocked =
    !current.data ||
    current.isError ||
    isExecuting(current.data.status) ||
    !workspace.data ||
    workspace.isError ||
    workspace.data.blocked
  const editingBusy = blocked || change.isPending || create.isPending
  const savePlan = (plan: ResearchWorkspace['selectedPlan']) => {
    const parsed = researchSelectedPlanSchema.safeParse(plan)
    if (!parsed.success || plan.directions.some((d) => !d.explanation.trim()))
      throw new Error('请先填写有效的方向名称和描述，再继续操作。')
    return updateWorkspace({
      kind: 'save_plan',
      plan,
      requestKey: createRequestId(),
      revision: draft?.revision ?? workspace.data!.revision,
    })
  }
  return (
    <ResearchShell
      title={project.data?.title ?? '研究工作台'}
      split={stage === 'plan' || stage === 'patents'}
      navigation={
        <div
          className={`mx-auto space-y-3 ${stage === 'plan' || stage === 'patents' ? 'w-full' : 'max-w-4xl'}`}
        >
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
                search={{
                  runId:
                    key === 'plan'
                      ? latest?.id
                      : (workspace.data?.executionRunId ?? latest?.id),
                }}
                aria-current={stage === key ? 'page' : undefined}
                className={`rounded-lg px-3 py-2.5 text-center text-xs transition-colors sm:text-sm ${stage === key ? 'bg-primary text-primary-foreground' : 'bg-muted/40 text-muted-foreground hover:bg-muted'}`}
              >
                {index + 1}. {item.title}
              </Link>
            ))}
          </nav>
        </div>
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

      {project.isPending && <p role='status'>正在读取研究…</p>}
      {project.data && !selected && (
        <p role='alert'>此记录不属于当前项目，请从左侧重新打开研究。</p>
      )}
      {readOnly && selected && (
        <p className='rounded-lg bg-muted p-3 text-sm text-muted-foreground'>
          正在查看历史记录。可返回调整研究，继续当前对话。
        </p>
      )}
      {stage === 'report' &&
        selected?.id === workspace.data?.latestResultRunId &&
        workspace.data?.resultOutdated && (
          <p className='rounded-lg bg-muted p-3 text-sm'>
            以下结果基于调整前的计划，确认当前计划并检索后将更新。
          </p>
        )}
      {selected && (
        <RunWorkspace
          key={`${selected.id}-${stage}`}
          id={selected.id}
          projectId={projectId}
          stage={stage}
          readOnly={readOnly}
          previousResultId={workspace.data?.latestResultRunId}
          directions={
            editorWorkspace && (
              <SelectedPlanEditor
                key={editorWorkspace.revision}
                workspace={editorWorkspace}
                initialPlan={draft?.plan}
                busy={editingBusy}
                onDirty={editPlan}
                onSave={savePlan}
                onStart={async (plan) => {
                  const saved = dirty ? await savePlan(plan) : workspace.data!
                  await updateWorkspace({
                    kind: 'start_search',
                    requestKey: createRequestId(),
                    revision: saved.revision,
                  })
                }}
              />
            )
          }
          conversation={(events) =>
            workspace.data && (
              <ProjectConversation
                workspace={workspace.data}
                projectId={projectId}
                busy={editingBusy}
                dirty={dirty}
                events={events}
                selectedPlan={draft?.plan ?? workspace.data.selectedPlan}
                onAdd={(direction) => {
                  const plan = draft?.plan ?? workspace.data!.selectedPlan
                  if (
                    editingBusy ||
                    plan.directions.length >= 3 ||
                    plan.directions.some(
                      (d) => d.domain_id === direction.domain_id
                    )
                  )
                    return
                  editPlan(true, {
                    ...plan,
                    directions: [
                      ...plan.directions,
                      {
                        ...direction,
                        keywords: [],
                        excluded_keywords: [],
                        cpc_prefixes: [],
                      },
                    ],
                  })
                }}
                onApply={(proposalRunId) =>
                  void updateWorkspace({
                    kind: 'apply_proposal',
                    proposalRunId,
                    requestKey: createRequestId(),
                    revision: workspace.data!.revision,
                  }).catch(() => undefined)
                }
              />
            )
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
                blocked={blocked || change.isPending}
                autoSave={dirty}
                thinking={thinking}
                onThinkingChange={setThinking}
                followUp
              />
            )
          }
        />
      )}
    </ResearchShell>
  )
}
