import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate } from '@tanstack/react-router'
import {
  researchSelectedPlanSchema,
  type ResearchProgressView,
  type ResearchAction,
  type ResearchWorkspace,
  type ResearchWorkspaceAction,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { ArrowRight, LoaderCircle, RefreshCw } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resetApiErrors } from '@/lib/api-error-notifications'
import { researchApi } from '@/lib/research-api'
import { CompanyWorkspace } from './company-workspace'
import { nodeLabels, statusLabels } from './labels'
import { PatentWorkspace } from './patent-workspace'
import { SelectedPlanEditor } from './plan-editor'
import { PlanRunFeedback } from './plan-run-feedback'
import { ProjectConversation } from './project-conversation'
import { ReportWorkspace } from './report-workspace'
import { ResearchComposer } from './research-composer'
import { ResearchPlanLayout } from './research-plan-layout'
import {
  researchStages,
  stageForEvent,
  stageForRun,
  type ResearchStage,
} from './research-stage'
import { ResearchTimeline } from './research-timeline'
import { ResearchShell } from './shared'
import { isExecuting, useResearchRun } from './use-research-run'

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
    onSuccess: async (run) => {
      client.setQueryData(['research', id, 'summary'], run)
      void client.invalidateQueries({ queryKey: ['research', id] })
      void client.invalidateQueries({
        queryKey: ['research', run.projectId, 'project'],
      })
      await client.invalidateQueries({
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
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-sm font-medium'>当前研究</span>
        <Badge variant={run.status === 'failed' ? 'destructive' : 'secondary'}>
          {run.status === 'recoverable' && !run.error
            ? '已暂停'
            : statusLabels[run.status]}
        </Badge>
        {stage !== 'patents' && stage !== 'companies' && (
          <span className='text-sm text-muted-foreground'>
            研究快照：
            {run.releaseId ?? '采集完成后生成'}
          </span>
        )}
        <Button
          variant='ghost'
          size='sm'
          className='ml-auto'
          disabled={summary.isFetching}
          onClick={() => {
            resetApiErrors()
            void summary.refetch()
          }}
        >
          <RefreshCw
            className={summary.isFetching ? 'animate-spin' : ''}
            aria-hidden='true'
          />
          {summary.isFetching ? '刷新中' : '刷新状态'}
        </Button>
      </div>
      {!run.ready && (
        <p role='status' className='text-sm'>
          请求已提交，正在等待开始。进度会自动更新。
        </p>
      )}
      {stage !== 'patents' &&
        stage !== 'companies' &&
        inCurrentStage &&
        run.acquisition && (
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
          实时连接暂时中断，正在重连。进度仍会自动更新，无需重复提交。
        </p>
      )}
      {inCurrentStage && run.error && (
        <div
          role='alert'
          className='space-y-1 rounded-lg bg-destructive/10 p-3 text-sm'
        >
          <p className='font-medium'>{run.error.message}</p>
          <p>当前步骤已停止。可重试此步骤，或取消研究。</p>
          <details className='text-muted-foreground'>
            <summary className='cursor-pointer py-1'>查看错误详情</summary>
            <p className='break-words'>
              出错步骤：
              {nodeLabels[run.error.node ?? run.node ?? ''] ?? '未知'} ·
              错误码：
              {run.error.code}
            </p>
          </details>
        </div>
      )}

      {!readOnly && inCurrentStage && (
        <div className='flex flex-wrap items-center gap-2 border-t pt-3'>
          {isExecuting(run.status) && (
            <Button
              variant='ghost'
              size='sm'
              disabled={mutation.isPending}
              onClick={() =>
                void submit({
                  action_id: createRequestId(),
                  kind: 'pause',
                  decisions: [],
                }).catch(() => undefined)
              }
            >
              {mutation.isPending && mutation.variables?.kind === 'pause'
                ? '正在暂停…'
                : '暂停研究'}
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
              {mutation.isPending && mutation.variables?.kind === 'retry'
                ? '正在恢复…'
                : run.status === 'recoverable' && !run.error
                  ? '继续研究'
                  : '重试此步骤'}
            </Button>
          )}
          {!['completed', 'empty', 'cancelled'].includes(run.status) && (
            <Button
              variant='ghost'
              size='sm'
              className='text-muted-foreground'
              disabled={mutation.isPending || cancelConfirm}
              onClick={() => setCancelConfirm(true)}
            >
              取消本次研究
            </Button>
          )}
        </div>
      )}
      {cancelConfirm &&
        !readOnly &&
        inCurrentStage &&
        !['completed', 'empty', 'cancelled'].includes(run.status) && (
          <div
            role='region'
            aria-label='确认取消研究'
            className='rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm'
          >
            <p className='mb-1 font-medium'>确定取消本次研究？</p>
            <p>取消后本次不能继续执行，已有记录和已发生费用保留。</p>
            <div className='mt-2 flex gap-2'>
              <Button
                size='sm'
                variant='outline'
                disabled={mutation.isPending}
                onClick={() => setCancelConfirm(false)}
              >
                暂不取消
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
                {mutation.isPending && mutation.variables?.kind === 'cancel'
                  ? '正在取消…'
                  : '确认取消'}
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
                  <div className='flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between'>
                    <div>
                      <p className='text-sm font-medium'>
                        下一步：查询相关企业
                      </p>
                      <p className='mt-1 text-xs text-muted-foreground'>
                        专利已采集完成，可根据专利查询相关企业。
                      </p>
                    </div>
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
                      {mutation.isPending &&
                      mutation.variables?.kind === 'start_companies' ? (
                        <>
                          <LoaderCircle
                            className='animate-spin'
                            aria-hidden='true'
                          />
                          正在启动…
                        </>
                      ) : (
                        <>
                          开始企业查询
                          <ArrowRight aria-hidden='true' />
                        </>
                      )}
                    </Button>
                  </div>
                )}
                {run.hasCompanies && (
                  <div className='flex flex-wrap items-center justify-between gap-3 border-t pt-3'>
                    <Button asChild>
                      <Link
                        to='/research/$projectId/$stage'
                        params={{ projectId, stage: 'companies' }}
                        search={{ runId: id }}
                      >
                        查看企业结果
                        <ArrowRight aria-hidden='true' />
                      </Link>
                    </Button>
                  </div>
                )}
              </>
            }
          />
        )}
      </div>
    )
  if (stage === 'companies')
    return (
      <div className='flex min-h-0 flex-1 flex-col'>
        {summary.isPending && <p role='status'>正在读取运行状态…</p>}
        {summary.isError && (
          <p role='alert'>运行状态加载失败，请刷新页面重试。</p>
        )}
        {run && (
          <CompanyWorkspace
            key={`${run.id}-${run.status}-${readOnly}`}
            run={run}
            events={(events.data ?? []).filter(
              (event) => stageForEvent(event) === 'companies'
            )}
            active={inCurrentStage && isExecuting(run.status)}
            readOnly={readOnly}
            busy={mutation.isPending}
            onSubmit={submit}
            controls={statusContent}
            recordsError={events.isError}
            retryRecords={() => void events.refetch()}
            report={
              run.hasResult && (
                <Button asChild>
                  <Link
                    to='/research/$projectId/$stage'
                    params={{ projectId, stage: 'report' }}
                    search={{ runId: id }}
                  >
                    查看研究报告
                    <ArrowRight aria-hidden='true' />
                  </Link>
                </Button>
              )
            }
          />
        )}
      </div>
    )
  const resultId = run?.hasResult ? run.id : (previousResultId ?? undefined)
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      {summary.isPending && <p role='status'>正在读取运行状态…</p>}
      {summary.isError && (
        <p role='alert'>
          运行状态加载失败。
          <Button variant='link' onClick={() => void summary.refetch()}>
            重新加载
          </Button>
        </p>
      )}
      {run && (
        <ReportWorkspace
          key={resultId ?? id}
          runId={resultId}
          controls={statusContent}
          records={timeline}
          notice={
            !run.hasResult && previousResultId ? (
              <p role='status' className='rounded-lg bg-muted p-3 text-sm'>
                新结果尚未生成，以下结果基于此前确认的计划。
              </p>
            ) : undefined
          }
          empty={
            <div className='space-y-4 rounded-xl border border-dashed p-5 text-sm'>
              <p>
                {inCurrentStage && isExecuting(run.status)
                  ? '正在分析证据并生成报告，完成后将在这里显示。'
                  : '请先在企业发现与核验页确认主体并生成报告。'}
              </p>
              {!inCurrentStage && (
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
            </div>
          }
        />
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
  const [pendingDraft, setDraft] = useState<{
    revision: number
    baseline: ResearchWorkspace['selectedPlan']
    plan: ResearchWorkspace['selectedPlan']
  } | null>(null)
  const draft = workspace.data?.researchCompleted ? null : pendingDraft
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
  const editingBusy =
    blocked ||
    change.isPending ||
    create.isPending ||
    !!workspace.data?.researchCompleted
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
  const stages = Object.keys(researchStages) as ResearchStage[]
  const reached = stages.indexOf(workspace.data?.reachedStage ?? 'plan')
  if (workspace.data && stages.indexOf(stage) > reached)
    return (
      <Navigate
        to='/research/$projectId/$stage'
        params={{ projectId, stage: workspace.data.reachedStage }}
        search={{ runId: workspace.data.executionRunId ?? undefined }}
        replace
      />
    )
  return (
    <ResearchShell
      title={project.data?.title ?? '研究工作台'}
      split
      navigation={
        <div className='mx-auto w-full space-y-3'>
          <nav
            aria-label='研究流程'
            className='grid grid-cols-2 gap-2 sm:grid-cols-4'
          >
            {(
              Object.entries(researchStages) as [
                ResearchStage,
                { title: string },
              ][]
            ).map(([key, item], index) =>
              index > reached ? (
                <button
                  key={key}
                  type='button'
                  disabled
                  title='尚未进行到此步骤'
                  className='cursor-not-allowed rounded-lg bg-muted/20 px-3 py-2.5 text-center text-xs text-muted-foreground/50 sm:text-sm'
                >
                  {index + 1}. {item.title}
                  <span className='mt-1 block text-[11px]'>未开始</span>
                </button>
              ) : (
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
                  <span className='mt-1 block text-[11px]'>
                    {index < reached || workspace.data?.researchCompleted
                      ? '已完成 · 可回看'
                      : '当前步骤'}
                  </span>
                </Link>
              )
            )}
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
      {selected &&
        (stage === 'plan' ||
          (workspace.data && stages.indexOf(stage) <= reached)) && (
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
