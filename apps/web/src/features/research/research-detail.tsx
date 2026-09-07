import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  type ResearchAction,
  type ResearchSummaryView,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { researchApi } from '@/lib/research-api'
import { EntityReview } from './entity-review'
import { eventLabels, nodeLabels, statusLabels } from './labels'
import { PlanEditor } from './plan-editor'
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
              版本 {query.data.releaseId} · {query.data.patentCount} 条去重专利
              · {query.data.companies.length} 个候选主体 ·{' '}
              {query.data.unverifiedCount} 个隔离条目
            </p>
            <p className='mt-2'>
              结果保留程序原始排序。现阶段可能包含非商业主体或宽泛硬件相关项；模型解释仅为标题/CPC
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
                    {c.country ?? '国家缺失'} ·{' '}
                    {c.identity === 'user_confirmed'
                      ? '本次人工确认身份'
                      : 'Catalog 关系匹配'}{' '}
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
                {run.sourceMode === 'browser'
                  ? '公开年份统计：'
                  : '授权年份统计：'}
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

function RunWorkspace({ id }: { id: string }) {
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
    } finally {
      sending.current = false
    }
  }
  const run = summary.data
  const currentStep = Object.keys(nodeLabels).indexOf(run?.node ?? '')
  return (
    <div className='space-y-6'>
      <ErrorNotice error={summary.error} retry={() => void summary.refetch()} />
      {summary.isPending && <p role='status'>正在读取运行状态…</p>}
      {run && (
        <>
          <div className='space-y-3 rounded-xl border p-5'>
            <div className='flex flex-wrap items-center gap-3'>
              <Badge
                variant={run.status === 'failed' ? 'destructive' : 'secondary'}
              >
                {statusLabels[run.status]}
              </Badge>
              <span className='text-sm text-muted-foreground'>
                数据版本：
                {run.releaseId ??
                  (run.sourceMode === 'browser' ? '采集完成后生成' : '待读取')}
              </span>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => void summary.refetch()}
              >
                刷新状态
              </Button>
            </div>
            <h2 className='font-medium break-words'>{run.question}</h2>
            {!run.ready && (
              <p role='status' className='text-sm'>
                等待研究服务接收请求，状态将自动刷新。
              </p>
            )}
            <ol aria-label='研究步骤' className='flex flex-wrap gap-2'>
              {Object.entries(nodeLabels).map(([key, label], index) => (
                <li
                  key={key}
                  aria-current={run.node === key ? 'step' : undefined}
                  className={`rounded-md px-2 py-1 text-xs ${run.node === key ? 'bg-primary text-primary-foreground' : index < currentStep ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  {index + 1}. {label}
                </li>
              ))}
            </ol>
            {run.acquisition && (
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
            {run.budget && (
              <p className='text-xs text-muted-foreground'>
                累计执行 {run.budget.elapsed_seconds.toFixed(1)} /{' '}
                {run.budget.max_seconds} 秒 · 模型调用 {run.budget.requests} /{' '}
                {run.budget.max_requests} 次 · 用量估算 ¥
                {run.budget.estimated_cny.toFixed(4)} · 已预留 ¥
                {run.budget.reserved_cny.toFixed(4)} / ¥{run.budget.max_cny}
                。人工等待不计时，重试不重置预算。
              </p>
            )}
            {isExecuting(run.status) && disconnected && (
              <p role='status' className='text-sm text-muted-foreground'>
                实时连接中断，正在重连；当前每 5 秒读取状态。不会自动重试模型。
              </p>
            )}
            {run.error && (
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
          {(run.status === 'awaiting_plan' ||
            (manual &&
              run.status === 'failed' &&
              (run.error?.node ?? run.node) === 'planner')) && (
            <PlanEditor run={run} busy={mutation.isPending} onSubmit={submit} />
          )}
          {run.confirmedPlan && (
            <details className='rounded-xl border p-4'>
              <summary className='cursor-pointer font-medium'>
                查看已确认计划（本轮锁定）
              </summary>
              <div className='mt-3 space-y-3 text-sm'>
                <p>
                  授权年份：{run.confirmedPlan.from_year}–
                  {run.confirmedPlan.to_year}
                </p>
                {run.confirmedPlan.directions.map((d, i) => (
                  <div key={i}>
                    <p className='font-medium'>{d.name}</p>
                    <p>
                      关键词：{d.keywords.join('、') || '不限'}；CPC：
                      {d.cpc_prefixes.join('、') || '不限'}
                    </p>
                    <p>排除词：{d.excluded_keywords.join('、') || '无'}</p>
                    <p className='text-muted-foreground'>{d.explanation}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
          {run.hasResult && <ResultPanel run={run} />}
          {(run.status === 'awaiting_entities' ||
            (run.hasResult && run.candidateCount > 0)) && (
            <EntityReview
              key={`${run.id}-${run.status}`}
              run={run}
              busy={mutation.isPending}
              onSubmit={submit}
            />
          )}
          <details className='rounded-xl border p-4'>
            <summary className='cursor-pointer font-medium'>运行事件</summary>
            <ErrorNotice
              error={events.error}
              retry={() => void events.refetch()}
            />
            <ol className='mt-3 max-h-72 space-y-2 overflow-y-auto text-xs'>
              {events.data?.map((e) => (
                <li key={e.sequence}>
                  {e.sequence}.{' '}
                  {new Date(e.createdAt).toLocaleTimeString('zh-CN')} ·{' '}
                  {nodeLabels[e.node ?? ''] ?? '研究'} ·{' '}
                  {statusLabels[e.status]} · {eventLabels[e.kind] ?? '状态更新'}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </div>
  )
}

export function ResearchDetail({
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
  const [newQuestion, setNewQuestion] = useState(''),
    [newOpen, setNewOpen] = useState(false)
  const requestKey = useRef({ question: '', id: createRequestId() })
  const client = useQueryClient(),
    navigate = useNavigate()
  const create = useMutation({
    mutationFn: () => {
      if (requestKey.current.question !== newQuestion.trim())
        requestKey.current = {
          question: newQuestion.trim(),
          id: createRequestId(),
        }
      return researchApi.newRun(projectId, {
        question: newQuestion.trim(),
        requestKey: requestKey.current.id,
      })
    },
    onSuccess: (run) => {
      setNewOpen(false)
      setNewQuestion('')
      requestKey.current = { question: '', id: createRequestId() }
      void client.invalidateQueries({
        queryKey: ['research', projectId, 'project'],
      })
      void navigate({
        to: '/research/$projectId',
        params: { projectId },
        search: { runId: run.id },
      })
    },
  })
  const runs = project.data?.runs ?? []
  const selected = runId
    ? runs.find((r) => r.id === runId)
    : runs[runs.length - 1]
  return (
    <ResearchShell>
      <div>
        <Link
          to='/research'
          className='text-sm text-muted-foreground hover:underline'
        >
          ← 返回研究列表
        </Link>
        <h1 className='mt-2 text-2xl font-bold break-words'>
          {project.data?.title ?? '研究详情'}
        </h1>
      </div>
      <ErrorNotice error={project.error} retry={() => void project.refetch()} />
      {project.isPending && <p role='status'>读取项目…</p>}
      {project.data && (
        <>
          <nav aria-label='研究轮次' className='flex flex-wrap gap-2'>
            {runs.map((r, i) => (
              <Button
                key={r.id}
                asChild
                variant={r.id === selected?.id ? 'default' : 'outline'}
                size='sm'
              >
                <Link
                  to='/research/$projectId'
                  params={{ projectId }}
                  search={{ runId: r.id }}
                >
                  第 {i + 1} 轮
                </Link>
              </Button>
            ))}
          </nav>
          {selected ? (
            <RunWorkspace key={selected.id} id={selected.id} />
          ) : (
            <p role='alert'>此轮次不属于当前项目。请选择上方已有轮次。</p>
          )}
          <section className='space-y-3 rounded-xl border p-5'>
            <h2 className='font-semibold'>开始新一轮</h2>
            <p className='text-sm text-muted-foreground'>
              更改研究范围会创建新运行，重新生成计划并使用独立预算，原有轮次保留。
            </p>
            {!newOpen ? (
              <Button
                variant='outline'
                onClick={() => {
                  setNewQuestion(project.data.question)
                  setNewOpen(true)
                }}
              >
                填写新一轮问题
              </Button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!create.isPending) create.mutate()
                }}
                className='space-y-3'
              >
                <Label htmlFor='new-round-question'>研究问题</Label>
                <Textarea
                  id='new-round-question'
                  required
                  maxLength={2000}
                  value={newQuestion}
                  disabled={create.isPending}
                  onChange={(e) => setNewQuestion(e.target.value)}
                />
                <ErrorNotice error={create.error} />
                <div className='flex gap-2'>
                  <Button disabled={!newQuestion.trim() || create.isPending}>
                    {create.isPending ? '创建中…' : '创建新一轮'}
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    disabled={create.isPending}
                    onClick={() => setNewOpen(false)}
                  >
                    收起
                  </Button>
                </div>
              </form>
            )}
          </section>
        </>
      )}
    </ResearchShell>
  )
}
