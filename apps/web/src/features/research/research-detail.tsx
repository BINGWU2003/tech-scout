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
import {
  ArrowRight,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ContentSkeleton, LoadingRegion } from '@/components/loading'
import { Button } from '@/components/ui/button'
import { resetApiErrors } from '@/lib/api-error-notifications'
import { researchApi } from '@/lib/research-api'
import { useAuthStore } from '@/stores/auth-store'
import { CompanyWorkspace } from './company-workspace'
import { nodeLabels } from './labels'
import { PatentWorkspace } from './patent-workspace'
import { SelectedPlanEditor } from './plan-editor'
import { ProjectConversation } from './project-conversation'
import { ReportWorkspace } from './report-workspace'
import { ResearchComposer } from './research-composer'
import { readResearchLocation, saveResearchLocation } from './research-location'
import { ResearchPlanLayout } from './research-plan-layout'
import {
  researchStages,
  researchStageLabel,
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
  const [refreshing, setRefreshing] = useState(false)
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
  const canResume = run?.status === 'recoverable' && !run.error
  const inCurrentStage = run ? stageForRun(run) === stage : false
  const failed =
    run?.status === 'failed' || (run?.status === 'recoverable' && !!run.error)
  const statusContent =
    run && inCurrentStage && failed ? (
      <section aria-label='研究异常' className='shrink-0'>
        {run.error ? (
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
        ) : (
          <p role='alert' className='rounded-lg bg-destructive/10 p-3 text-sm'>
            当前步骤执行失败，请重试。
          </p>
        )}
      </section>
    ) : null
  const header = (
    <div className='mb-4 shrink-0 space-y-3'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h1 className='text-2xl font-semibold tracking-tight'>
            {researchStages[stage].title}
          </h1>
          <p className='mt-2 text-sm leading-6 text-muted-foreground'>
            {researchStages[stage].description}
          </p>
        </div>
        {run && (
          <div
            className='flex flex-wrap items-center gap-2'
            aria-label='研究操作'
          >
            {!readOnly && inCurrentStage && (
              <div className='flex flex-wrap items-center gap-2'>
                {isExecuting(run.status) && (
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={
                      mutation.isPending && mutation.variables?.kind === 'pause'
                        ? '正在暂停…'
                        : '暂停研究'
                    }
                    title='暂停研究'
                    disabled={mutation.isPending}
                    onClick={() =>
                      void submit({
                        action_id: createRequestId(),
                        kind: 'pause',
                      }).catch(() => undefined)
                    }
                  >
                    {mutation.isPending &&
                    mutation.variables?.kind === 'pause' ? (
                      <LoaderCircle
                        className='motion-safe:animate-spin'
                        aria-hidden='true'
                      />
                    ) : (
                      <Pause aria-hidden='true' />
                    )}
                  </Button>
                )}
                {['failed', 'recoverable'].includes(run.status) && (
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={
                      mutation.isPending && mutation.variables?.kind === 'retry'
                        ? '正在恢复…'
                        : canResume
                          ? '继续研究'
                          : '重试此步骤'
                    }
                    title={canResume ? '继续研究' : '重试此步骤'}
                    disabled={mutation.isPending}
                    onClick={() =>
                      void submit({
                        action_id: createRequestId(),
                        kind: 'retry',
                      }).catch(() => undefined)
                    }
                  >
                    {mutation.isPending &&
                    mutation.variables?.kind === 'retry' ? (
                      <LoaderCircle
                        className='motion-safe:animate-spin'
                        aria-hidden='true'
                      />
                    ) : canResume ? (
                      <Play aria-hidden='true' />
                    ) : (
                      <RotateCcw aria-hidden='true' />
                    )}
                  </Button>
                )}
                {!['completed', 'empty', 'cancelled'].includes(run.status) && (
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label='取消本次研究'
                    title='取消本次研究'
                    disabled={mutation.isPending || cancelConfirm}
                    onClick={() => setCancelConfirm(true)}
                    className='text-destructive hover:text-destructive'
                  >
                    <X aria-hidden='true' />
                  </Button>
                )}
              </div>
            )}
            <Button
              variant='ghost'
              size='icon'
              aria-label='刷新状态'
              title='刷新状态'
              disabled={summary.isFetching}
              onClick={() => {
                resetApiErrors()
                setRefreshing(true)
                void summary.refetch().finally(() => setRefreshing(false))
              }}
            >
              <RefreshCw
                className={summary.isFetching ? 'motion-safe:animate-spin' : ''}
                aria-hidden='true'
              />
            </Button>
          </div>
        )}
      </div>
      {run &&
        !readOnly &&
        inCurrentStage &&
        !['completed', 'empty', 'cancelled'].includes(run.status) && (
          <ConfirmDialog
            open={cancelConfirm}
            onOpenChange={(open) => {
              if (!mutation.isPending) setCancelConfirm(open)
            }}
            title='确定取消本次研究？'
            desc='取消后本次不能继续执行，已有记录和已发生费用保留。'
            cancelBtnText='暂不取消'
            confirmText={
              mutation.isPending && mutation.variables?.kind === 'cancel'
                ? '正在取消…'
                : '确认取消'
            }
            destructive
            isLoading={mutation.isPending}
            handleConfirm={() =>
              void submit({
                action_id: createRequestId(),
                kind: 'cancel',
              }).catch(() => undefined)
            }
          >
            {mutation.isError && mutation.variables?.kind === 'cancel' && (
              <p role='alert' className='text-sm text-destructive'>
                取消失败，请重试。
              </p>
            )}
          </ConfirmDialog>
        )}
      {run && isExecuting(run.status) && disconnected && (
        <p role='status' className='text-sm text-muted-foreground'>
          实时连接暂时中断，正在重连。进度仍会自动更新，无需重复提交。
        </p>
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
      <LoadingRegion busy={refreshing} className='flex min-h-0 flex-1 flex-col'>
        {header}
        {summary.isPending && !directions && (
          <ContentSkeleton variant='workspace' label='正在读取运行状态…' />
        )}
        {(run || directions) && (
          <ResearchPlanLayout
            directions={directions}
            conversation={conversation?.(events.data ?? [])}
            composer={
              <>
                {statusContent}
                {composer}
              </>
            }
          />
        )}
      </LoadingRegion>
    )
  if (stage === 'patents')
    return (
      <LoadingRegion busy={refreshing} className='flex min-h-0 flex-1 flex-col'>
        {header}
        {summary.isPending && (
          <ContentSkeleton variant='workspace' label='正在读取运行状态…' />
        )}
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
            controls={statusContent}
            actions={
              <>
                {!readOnly && run.status === 'awaiting_companies' && (
                  <div className='flex items-center gap-2'>
                    <Button
                      disabled={mutation.isPending}
                      onClick={() =>
                        void submit({
                          action_id: createRequestId(),
                          kind: 'start_companies',
                        }).catch(() => undefined)
                      }
                    >
                      {mutation.isPending &&
                      mutation.variables?.kind === 'start_companies' ? (
                        <>
                          <LoaderCircle
                            className='motion-safe:animate-spin'
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
                  <div className='flex flex-wrap items-center gap-2'>
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
      </LoadingRegion>
    )
  if (stage === 'companies')
    return (
      <LoadingRegion busy={refreshing} className='flex min-h-0 flex-1 flex-col'>
        {header}
        {summary.isPending && (
          <ContentSkeleton variant='workspace' label='正在读取运行状态…' />
        )}
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
            controls={statusContent}
            recordsError={events.isError}
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
      </LoadingRegion>
    )
  const resultId = run?.hasResult ? run.id : (previousResultId ?? undefined)
  return (
    <LoadingRegion busy={refreshing} className='flex min-h-0 flex-1 flex-col'>
      {header}
      {summary.isPending && (
        <ContentSkeleton variant='workspace' label='正在读取运行状态…' />
      )}
      {summary.isError && <p role='alert'>运行状态加载失败。</p>}
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
                  ? '正在评估专利和企业调研线索，完成后将在这里显示。'
                  : '请先在专利检索页开始企业发现，报告随后自动生成。'}
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
    </LoadingRegion>
  )
}

export function ResearchEntry({
  projectId,
  runId,
}: {
  projectId: string
  runId?: string
}) {
  const userId = useAuthStore((state) => state.auth.user?.id)
  const saved = readResearchLocation(userId, projectId)
  const project = useQuery({
    queryKey: ['research', projectId, 'project'],
    queryFn: () => researchApi.project(projectId),
  })
  const runs = project.data?.runs ?? []
  const workspace = useQuery({
    queryKey: ['research', projectId, 'workspace'],
    queryFn: () => researchApi.workspace(projectId),
    enabled: !runId,
  })
  const restored =
    !runId && saved && runs.some((run) => run.id === saved.runId) ? saved : null
  const targetRunId = runId ?? restored?.runId ?? workspace.data?.executionRunId
  const selected = runId
    ? runs.find((run) => run.id === runId)
    : (runs.find((run) => run.id === targetRunId) ?? runs[runs.length - 1])
  const summary = useQuery({
    queryKey: ['research', selected?.id, 'summary'],
    queryFn: () => researchApi.summary(selected!.id),
    enabled: Boolean(selected),
  })
  if (summary.data && (runId || workspace.data))
    return (
      <Navigate
        to='/research/$projectId/$stage'
        params={{
          projectId,
          stage: runId
            ? stageForRun(summary.data)
            : (restored?.stage ?? workspace.data!.reachedStage),
        }}
        search={{ runId: selected!.id }}
        replace
      />
    )
  return (
    <ResearchShell>
      {project.isError || summary.isError || (!runId && workspace.isError) ? (
        <p role='alert'>研究加载失败，请刷新页面重试。</p>
      ) : project.data && !selected ? (
        <p role='status'>此记录不存在，请从左侧重新打开项目。</p>
      ) : (
        <ContentSkeleton variant='workspace' label='正在打开研究…' />
      )}
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
  const planLocked =
    !!workspace.data?.executionRunId || !!workspace.data?.researchCompleted
  const draft = planLocked ? null : pendingDraft
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
  const [generatingKeywords, setGeneratingKeywords] = useState(false)
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
    planLocked ||
    generatingKeywords
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
  const userId = useAuthStore((state) => state.auth.user?.id)
  const viewedRunId = selected?.id
  const canRemember = !!workspace.data && stages.indexOf(stage) <= reached
  useEffect(() => {
    if (canRemember && viewedRunId)
      saveResearchLocation(userId, projectId, { stage, runId: viewedRunId })
  }, [userId, projectId, stage, viewedRunId, canRemember])
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
                    {workspace.data
                      ? researchStageLabel(key, workspace.data)
                      : '加载中'}
                    {workspace.data && index === reached && (
                      <span className='ml-1.5 inline-block rounded border border-current/30 px-1'>
                        当前步骤
                      </span>
                    )}
                  </span>
                </Link>
              )
            )}
          </nav>
        </div>
      }
    >
      {project.isPending && (
        <ContentSkeleton variant='workspace' label='正在读取研究…' />
      )}
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
            key={`${stage === 'plan' ? projectId : selected.id}-${stage}`}
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
                  lockedActions={
                    <div className='flex flex-wrap items-center gap-2'>
                      <Button asChild variant='outline'>
                        <Link to='/research'>新建研究</Link>
                      </Button>
                      <Button asChild className='ml-auto'>
                        <Link
                          to='/research/$projectId/$stage'
                          params={{
                            projectId,
                            stage: workspace.data!.reachedStage,
                          }}
                          search={{
                            runId: workspace.data!.executionRunId ?? selectedId,
                          }}
                        >
                          前往当前步骤
                        </Link>
                      </Button>
                    </div>
                  }
                  busy={editingBusy}
                  onDirty={editPlan}
                  onSave={savePlan}
                  onGenerateKeywords={async (direction) => {
                    setGeneratingKeywords(true)
                    try {
                      return await researchApi.generateKeywords(projectId, {
                        requestKey: createRequestId(),
                        direction: {
                          domain_id: direction.domain_id,
                          name: direction.name,
                          explanation: direction.explanation,
                        },
                      })
                    } finally {
                      setGeneratingKeywords(false)
                      void client.invalidateQueries({
                        queryKey: ['research', projectId],
                      })
                    }
                  }}
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
                          keywords: direction.keywords,
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
              !readOnly &&
              (planLocked ? (
                <p
                  role='status'
                  className='px-4 py-3 text-sm text-muted-foreground'
                >
                  技术方向已确认，无法继续追问。
                </p>
              ) : (
                <ResearchComposer
                  value={question}
                  onChange={setQuestion}
                  onSubmit={() => create.mutate()}
                  busy={create.isPending}
                  blocked={blocked || change.isPending || generatingKeywords}
                  autoSave={dirty}
                  thinking={thinking}
                  onThinkingChange={setThinking}
                  followUp
                />
              ))
            }
          />
        )}
    </ResearchShell>
  )
}
