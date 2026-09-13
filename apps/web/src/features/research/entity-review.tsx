import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  type ResearchAction,
  type ResearchCandidateDetailView,
  type ResearchSummaryView,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { ChevronRight } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ContentSkeleton } from '@/components/loading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { researchApi } from '@/lib/research-api'
import { useAuthStore } from '@/stores/auth-store'
import { CompanyDialog, CompanyNavigation } from './company-dialog'
import { nextCompanyListPage } from './company-list-data'
import { CompanyListPagination } from './company-list-pagination'
import { loadReviewDraft } from './company-review-data'
import { candidateCountryLabel, countryName, decisionLabels } from './labels'
import { SourceReference } from './shared'

type Decision = ResearchAction['decisions'][number]
export function CandidateEditor({
  detail,
  initial,
  editable,
  save,
}: {
  detail: ResearchCandidateDetailView
  initial?: Decision
  editable: boolean
  save: (v: Decision) => void
}) {
  const [choice, setChoice] = useState<Decision['action'] | ''>(
    initial?.action ?? ''
  )
  const [company, setCompany] = useState(initial?.company_id ?? '')
  const [evidence, setEvidence] = useState<string[]>(
    initial?.evidence_ids ?? []
  )
  const [note, setNote] = useState(initial?.note ?? '')
  const option = detail.companyOptions.find((c) => c.id === company)
  const supported = option?.supportingEvidenceIds.some((id) =>
    evidence.includes(id)
  )
  return (
    <div className='space-y-4'>
      <p className='text-sm'>
        中国专利 · 关联 {detail.patentCount} 条 ·{' '}
        {decisionLabels[detail.decision ?? detail.status] ?? '待核验'}
      </p>
      <p className='text-xs text-muted-foreground'>
        {candidateCountryLabel(detail)}
      </p>
      {detail.reviewNote && (
        <p className='rounded-md bg-muted p-3 text-sm'>{detail.reviewNote}</p>
      )}
      <p className='text-xs text-muted-foreground'>
        请根据名称、注册地和标识信息核对主体身份。身份匹配不代表产品能力已核实。
      </p>
      {editable && (
        <div className='space-y-2'>
          <Label htmlFor='identity-choice'>本次决定</Label>
          <Select
            value={choice}
            onValueChange={(value) => setChoice(value as Decision['action'])}
          >
            <SelectTrigger id='identity-choice' className='w-full'>
              <SelectValue placeholder='请选择，不默认确认' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='confirm' disabled={detail.terminalExclusion}>
                确认匹配已有公司
              </SelectItem>
              <SelectItem value='reject'>拒绝本次匹配</SelectItem>
              <SelectItem value='skip'>依据不足，跳过</SelectItem>
            </SelectContent>
          </Select>
          {choice === 'confirm' && (
            <>
              <Label htmlFor='identity-company'>选择快照中的公司</Label>
              <Select
                value={company}
                onValueChange={(value) => {
                  setCompany(value)
                  setEvidence([])
                }}
              >
                <SelectTrigger
                  id='identity-company'
                  className='w-full min-w-0 [&_[data-slot=select-value]]:truncate'
                >
                  <SelectValue placeholder='请选择公司' />
                </SelectTrigger>
                <SelectContent className='max-w-[calc(100vw-2rem)]'>
                  {detail.companyOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id} className='break-words'>
                      {c.name} · 企业注册地：{countryName(c.country)}
                      {c.supportingEvidenceIds.length ? '（有支持依据）' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>
                请选择至少一条支持所选公司身份的依据。
              </p>
            </>
          )}
        </div>
      )}
      <div className='space-y-3'>
        {detail.evidence.length === 0 && (
          <p className='text-sm text-muted-foreground'>
            当前没有保存的身份依据。
          </p>
        )}
        {detail.evidence.map((e) => (
          <div key={e.id} className='rounded-lg border p-3 text-sm'>
            <label className='flex items-start gap-2'>
              {editable && choice === 'confirm' && (
                <input
                  type='checkbox'
                  aria-label={`选择证据 ${e.id}`}
                  checked={evidence.includes(e.id)}
                  onChange={(event) =>
                    setEvidence((ids) =>
                      event.target.checked
                        ? [...ids, e.id]
                        : ids.filter((id) => id !== e.id)
                    )
                  }
                  className='mt-1'
                />
              )}
              <span className='break-all'>
                {e.publisher ?? '未知发布者'} · {e.legalName ?? e.id}
                {option?.supportingEvidenceIds.includes(e.id) && (
                  <span className='ml-2 text-xs text-primary'>
                    支持所选身份
                  </span>
                )}
              </span>
            </label>
            <p className='mt-1 text-xs break-all'>
              {e.identifierType ?? '无标识类型'}：
              {e.identifierValue ?? '未提供'} · 注册国家：
              {countryName(e.country)}
            </p>
            <details className='mt-2 text-xs'>
              <summary className='cursor-pointer text-muted-foreground'>
                来源与存档信息
              </summary>
              <p>
                观察时间：{e.observedAt ?? '缺失'} ·{' '}
                {e.preserved ? '已存档' : '未存档'} ·{' '}
                {e.contentHash ? '有内容哈希' : '无内容哈希'}
              </p>
              <SourceReference source={e.source} />
            </details>
          </div>
        ))}
      </div>
      {editable && (
        <>
          <Label htmlFor='identity-note'>决定说明（可选）</Label>
          <Textarea
            id='identity-note'
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            disabled={
              !choice ||
              (choice === 'confirm' &&
                (detail.terminalExclusion ||
                  !supported ||
                  evidence.length > 30))
            }
            onClick={() => {
              if (choice)
                save({
                  candidate_id: detail.id,
                  action: choice,
                  company_id: choice === 'confirm' ? company : null,
                  evidence_ids: choice === 'confirm' ? evidence : [],
                  note,
                })
            }}
          >
            暂存并继续核验
          </Button>
        </>
      )}
    </div>
  )
}

function CandidatePanel({
  runId,
  id,
  editable,
  initial,
  save,
}: {
  runId: string
  id: string
  editable: boolean
  initial?: Decision
  save: (v: Decision) => void
}) {
  const query = useQuery({
    queryKey: ['research', runId, 'candidate', id],
    queryFn: () => researchApi.candidate(runId, id),
  })
  return (
    <section className='space-y-4'>
      <h3 className='text-base font-semibold break-words'>
        {query.data?.name ?? '主体依据'}
      </h3>
      {query.isPending && (
        <ContentSkeleton variant='detail' label='读取身份依据…' />
      )}
      {query.isError && (
        <p role='alert'>
          身份依据加载失败。
          <Button variant='link' onClick={() => void query.refetch()}>
            重试
          </Button>
        </p>
      )}
      {query.data && (
        <CandidateEditor
          key={id}
          detail={query.data}
          initial={initial}
          editable={editable}
          save={save}
        />
      )}
    </section>
  )
}

export function EntityReview({
  run,
  busy,
  onSubmit,
  readOnly = false,
  renderWorkspace,
}: {
  run: ResearchSummaryView
  busy: boolean
  onSubmit: (a: ResearchAction) => Promise<void>
  readOnly?: boolean
  renderWorkspace: (parts: {
    list: ReactNode
    detail: ReactNode
    footer: ReactNode
    selected: string | null
    saved: number
    remaining: number
  }) => ReactNode
}) {
  const editable = !readOnly && run.status === 'awaiting_entities'
  const [selected, setSelected] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const userId = useAuthStore((state) => state.auth.user?.id)
  const storageKey = userId ? `research-review-v1:${userId}:${run.id}` : null
  const [draft, updateDraft] = useState<Record<string, Decision>>(() =>
    editable ? loadReviewDraft(storageKey, run.pendingCandidateIds) : {}
  )
  const [storageError, setStorageError] = useState(false)
  const setDraft = (
    value:
      | Record<string, Decision>
      | ((old: Record<string, Decision>) => Record<string, Decision>)
  ) => {
    const next = typeof value === 'function' ? value(draft) : value
    updateDraft(next)
    try {
      if (!storageKey) throw new Error('No user')
      if (Object.keys(next).length)
        localStorage.setItem(storageKey, JSON.stringify(Object.values(next)))
      else localStorage.removeItem(storageKey)
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }
  const [skipConfirm, setSkipConfirm] = useState(false)
  const query = useInfiniteQuery({
    queryKey: ['research', run.id, 'candidates', 'infinite', editable],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      researchApi.candidates(run.id, pageParam, editable),
    getNextPageParam: nextCompanyListPage,
    enabled: run.hasCompanies,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const total = query.data?.pages[0].total ?? 0
  const remaining = run.pendingCandidateIds.filter((id) => !draft[id])
  const [submitError, setSubmitError] = useState(false)
  const submit = async () => {
    if (!editable || busy || remaining.length) return
    setSubmitError(false)
    await onSubmit({
      action_id: createRequestId(),
      kind: 'resolve_entities',
      decisions: run.pendingCandidateIds.map((id) => draft[id]),
    })
      .then(() => setDraft({}))
      .catch(() => setSubmitError(true))
  }
  const list = (
    <div className='flex flex-col gap-4'>
      <div>
        <h3 className='text-sm font-semibold'>
          {editable ? '确认待核验主体' : '未核验主体与处理记录'}
        </h3>
        <p className='mt-1 text-sm text-muted-foreground'>
          {editable
            ? `共 ${run.pendingCandidateIds.length} 项，尚有 ${remaining.length} 项未选择。暂存后可在本浏览器恢复，全部处理后统一提交。`
            : '保留证据不足、非公司与已拒绝条目，避免把未核验主体算入名单。'}
        </p>
      </div>

      {storageError && (
        <p role='alert' className='text-sm text-destructive'>
          本地保存失败，当前决定仅保留在本页，请勿刷新或离开。
        </p>
      )}
      {query.isError && !query.isFetchNextPageError && (
        <p role='alert'>
          主体列表加载失败。
          <Button variant='link' onClick={() => void query.refetch()}>
            重试
          </Button>
        </p>
      )}
      {query.isPending && (
        <ContentSkeleton variant='list' label='读取主体列表…' />
      )}
      {query.data && total === 0 && (
        <p className='text-sm text-muted-foreground'>暂无需要核验的主体。</p>
      )}
      <ul aria-label='待核验主体与处理记录列表' className='divide-y border-y'>
        {items.map((u) => (
          <li key={u.id}>
            <button
              type='button'
              aria-label={`${editable ? '查看并处理' : '查看依据'}：${u.name}`}
              aria-pressed={selected === u.id}
              disabled={busy}
              onClick={(event) => {
                trigger.current = event.currentTarget
                setSelected(u.id)
              }}
              className='flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-primary/10'
            >
              <span className='min-w-0 flex-1 space-y-1.5'>
                <span className='flex flex-wrap items-start gap-x-2 gap-y-1'>
                  <span className='min-w-0 text-sm leading-6 font-medium break-words'>
                    {u.name}
                  </span>
                  <Badge variant='secondary' className='mt-1 shrink-0'>
                    {draft[u.id]
                      ? `已暂存：${decisionLabels[draft[u.id].action]}`
                      : (decisionLabels[u.decision ?? u.status] ?? '待核验')}
                  </Badge>
                </span>
                <span className='block text-xs leading-5 break-words text-muted-foreground'>
                  中国专利 · 关联 {u.patentCount} 条 ·{' '}
                  {candidateCountryLabel(u)}
                </span>
              </span>
              <ChevronRight
                className='size-4 shrink-0 text-muted-foreground'
                aria-hidden='true'
              />
            </button>
          </li>
        ))}
      </ul>
      {query.data && total > 0 && (
        <CompanyListPagination
          loaded={items.length}
          total={total}
          hasNextPage={query.hasNextPage}
          isFetching={query.isFetching}
          isFetchingNextPage={query.isFetchingNextPage}
          isFetchNextPageError={query.isFetchNextPageError}
          fetchNextPage={query.fetchNextPage}
          paused={busy || Boolean(selected)}
        />
      )}
    </div>
  )
  const footer = (
    <>
      {storageError && (
        <p role='alert' className='text-sm text-destructive'>
          本地保存失败，请在离开前完成提交。
        </p>
      )}
      {submitError && <p role='alert'>提交失败，草稿已保留，请重试。</p>}
      {editable && (
        <div className='w-full space-y-3'>
          <p className='text-xs text-muted-foreground'>
            已暂存 {run.pendingCandidateIds.length - remaining.length} 项 ·
            尚待处理 {remaining.length} 项
          </p>
          <div className='flex flex-wrap justify-end gap-2'>
            <Button
              variant='outline'
              disabled={busy || !remaining.length}
              onClick={() => setSkipConfirm(true)}
            >
              跳过剩余 {remaining.length} 项
            </Button>
            <Button
              disabled={
                busy || remaining.length > 0 || query.isPending || query.isError
              }
              onClick={() => void submit()}
            >
              {busy
                ? '提交中…'
                : run.pendingCandidateIds.length
                  ? '确认主体并生成报告'
                  : '生成研究报告'}
            </Button>
          </div>
          <ConfirmDialog
            open={skipConfirm}
            onOpenChange={(open) => {
              if (!busy) setSkipConfirm(open)
            }}
            title='确认跳过剩余主体？'
            desc={`将尚未选择的 ${remaining.length} 项标记为“跳过”，保留已经暂存的决定。此操作只更新草稿。`}
            cancelBtnText='返回'
            confirmText='确认标记为跳过'
            isLoading={busy}
            disabled={!remaining.length}
            handleConfirm={() => {
              if (busy || !remaining.length) return
              setDraft((d) => ({
                ...d,
                ...Object.fromEntries(
                  remaining.map((id) => [
                    id,
                    {
                      candidate_id: id,
                      action: 'skip',
                      company_id: null,
                      evidence_ids: [],
                      note: '人工选择跳过，当前依据不足',
                    } satisfies Decision,
                  ])
                ),
              }))
              setSkipConfirm(false)
            }}
          />
        </div>
      )}
    </>
  )
  const detail = selected ? (
    <CompanyDialog
      contentKey={selected}
      title='主体核验'
      description='查看本次研究的身份依据与核验记录。'
      close={() => setSelected(null)}
      returnFocus={() => trigger.current?.focus({ preventScroll: true })}
      navigation={
        <CompanyNavigation
          ids={
            editable ? run.pendingCandidateIds : items.map((item) => item.id)
          }
          selected={selected}
          select={setSelected}
          total={editable ? run.pendingCandidateIds.length : total}
          disabled={busy}
          hasNextPage={!editable && query.hasNextPage}
          loadMore={async () => {
            const result = await query.fetchNextPage()
            if (result.isFetchNextPageError) throw result.error
            return (
              result.data?.pages.flatMap((page) =>
                page.items.map((item) => item.id)
              ) ?? []
            )
          }}
        />
      }
    >
      <CandidatePanel
        key={selected}
        runId={run.id}
        id={selected}
        editable={editable && !busy}
        initial={draft[selected]}
        save={(value) => {
          const next = { ...draft, [value.candidate_id]: value }
          setDraft(next)
          setSelected(run.pendingCandidateIds.find((id) => !next[id]) ?? null)
        }}
      />
    </CompanyDialog>
  ) : null
  return renderWorkspace({
    list,
    detail,
    footer,
    selected,
    saved: run.pendingCandidateIds.filter((id) => Boolean(draft[id])).length,
    remaining: remaining.length,
  })
}
