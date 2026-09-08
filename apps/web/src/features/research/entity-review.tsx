import { useQuery } from '@tanstack/react-query'
import {
  type ResearchAction,
  type ResearchCandidateDetailView,
  type ResearchSummaryView,
} from '@tech-scout/contracts'
import { createRequestId } from '@tech-scout/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { researchApi } from '@/lib/research-api'
import { decisionLabels } from './labels'
import { ErrorNotice, Pager, SourceReference } from './shared'

type Decision = ResearchAction['decisions'][number]
function CandidateEditor({
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
        {detail.country ?? '国家缺失'} · {detail.patentCount} 条专利 ·{' '}
        {decisionLabels[detail.decision ?? detail.status] ?? '待核验'}
      </p>
      {detail.reviewNote && (
        <p className='rounded-md bg-muted p-3 text-sm'>{detail.reviewNote}</p>
      )}
      <p className='text-xs text-muted-foreground'>
        以下均为本次快照中的身份依据，不证明产品能力，来源正文未提供。
      </p>
      {editable && (
        <div className='space-y-2'>
          <Label htmlFor='identity-choice'>本次决定</Label>
          <select
            id='identity-choice'
            className='h-9 w-full rounded-md border bg-background px-3'
            value={choice}
            onChange={(e) =>
              setChoice(e.target.value as Decision['action'] | '')
            }
          >
            <option value=''>请选择，不默认确认</option>
            <option value='confirm' disabled={detail.terminalExclusion}>
              确认匹配已有公司
            </option>
            <option value='reject'>拒绝本次匹配</option>
            <option value='skip'>依据不足，跳过</option>
          </select>
          {choice === 'confirm' && (
            <>
              <Label htmlFor='identity-company'>选择快照中的公司</Label>
              <select
                id='identity-company'
                className='h-9 w-full rounded-md border bg-background px-3 text-sm'
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value)
                  setEvidence([])
                }}
              >
                <option value=''>请选择公司</option>
                {detail.companyOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.country ?? '国家缺失'}
                    {c.supportingEvidenceIds.length ? '（有支持依据）' : ''}
                  </option>
                ))}
              </select>
              <p className='text-xs text-muted-foreground'>
                必须勾选至少一条支持所选公司标识或法律名称与国家的依据。服务端会再次校验。
              </p>
            </>
          )}
        </div>
      )}
      <div className='max-h-72 space-y-3 overflow-y-auto'>
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
              {e.identifierValue ?? '未提供'} · {e.country ?? '国家缺失'}
            </p>
            <p className='text-xs'>
              观察时间：{e.observedAt ?? '缺失'} ·{' '}
              {e.preserved ? '已存档' : '未存档'} ·{' '}
              {e.contentHash ? '有内容哈希' : '无内容哈希'}
            </p>
            <SourceReference source={e.source} />
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
              (choice === 'confirm' && (!supported || evidence.length > 30))
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
            暂存此项决定
          </Button>
        </>
      )}
    </div>
  )
}

function CandidateDialog({
  runId,
  id,
  editable,
  initial,
  save,
  close,
}: {
  runId: string
  id: string
  editable: boolean
  initial?: Decision
  save: (v: Decision) => void
  close: () => void
}) {
  const query = useQuery({
    queryKey: ['research', runId, 'candidate', id],
    queryFn: () => researchApi.candidate(runId, id),
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{query.data?.name ?? '主体依据'}</DialogTitle>
          <DialogDescription>
            核对决定保存在本次研究中，保留原始网页证据。
          </DialogDescription>
        </DialogHeader>
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        {query.isPending && <p role='status'>读取身份依据…</p>}
        {query.data && (
          <CandidateEditor
            detail={query.data}
            initial={initial}
            editable={editable}
            save={save}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

export function EntityReview({
  run,
  busy,
  onSubmit,
}: {
  run: ResearchSummaryView
  busy: boolean
  onSubmit: (a: ResearchAction) => Promise<void>
}) {
  const editable = run.status === 'awaiting_entities'
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, Decision>>({})
  const [skipConfirm, setSkipConfirm] = useState(false)
  const query = useQuery({
    queryKey: ['research', run.id, 'candidates', page, editable],
    queryFn: () => researchApi.candidates(run.id, page, editable),
  })
  const remaining = run.pendingCandidateIds.filter((id) => !draft[id])
  const submit = async () => {
    await onSubmit({
      action_id: createRequestId(),
      kind: 'resolve_entities',
      decisions: run.pendingCandidateIds.map((id) => draft[id]),
    })
      .then(() => setDraft({}))
      .catch(() => undefined)
  }
  return (
    <section className='space-y-4 rounded-xl border p-5'>
      <div>
        <h2 className='text-lg font-semibold'>
          {editable ? '确认待核验主体' : '未核验主体与处理记录'}
        </h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          {editable
            ? `共 ${run.pendingCandidateIds.length} 项，尚有 ${remaining.length} 项未选择。草稿翻页保留，离开本页不保存；全部处理后统一提交。`
            : '保留证据不足、非公司与已拒绝条目，避免把未核验主体算入名单。'}
        </p>
      </div>
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      {query.isPending && <p role='status'>读取主体列表…</p>}
      <div className='divide-y'>
        {query.data?.items.map((u) => (
          <div
            key={u.id}
            className='flex flex-wrap items-center justify-between gap-3 py-3'
          >
            <div className='min-w-0'>
              <p className='text-sm font-medium break-words'>{u.name}</p>
              <p className='text-xs text-muted-foreground'>
                {u.patentCount} 条专利 ·{' '}
                {draft[u.id]
                  ? `已暂存：${decisionLabels[draft[u.id].action]}`
                  : (decisionLabels[u.decision ?? u.status] ?? '待核验')}
              </p>
            </div>
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => setSelected(u.id)}
            >
              {editable ? '查看并处理' : '查看依据'}
            </Button>
          </div>
        ))}
      </div>
      {query.data && (
        <Pager page={page} total={query.data.total} onChange={setPage} />
      )}
      {editable && (
        <div className='space-y-3'>
          <div className='flex flex-wrap gap-3'>
            <Button
              variant='outline'
              disabled={busy || !remaining.length}
              onClick={() => setSkipConfirm(true)}
            >
              跳过剩余 {remaining.length} 项
            </Button>
            <Button
              disabled={
                busy || remaining.length > 0 || !run.pendingCandidateIds.length
              }
              onClick={() => void submit()}
            >
              {busy ? '提交中…' : '统一提交并继续研究'}
            </Button>
          </div>
          {skipConfirm && (
            <div className='rounded-lg bg-muted p-3 text-sm'>
              <p>
                将尚未选择的 {remaining.length}{' '}
                项标记为“跳过”，保留已经暂存的决定。此操作只更新草稿。
              </p>
              <div className='mt-2 flex gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setSkipConfirm(false)}
                >
                  返回
                </Button>
                <Button
                  size='sm'
                  onClick={() => {
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
                >
                  确认标记为跳过
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {selected && (
        <CandidateDialog
          key={selected}
          runId={run.id}
          id={selected}
          editable={editable && !busy}
          initial={draft[selected]}
          close={() => setSelected(null)}
          save={(value) => {
            setDraft((d) => ({ ...d, [value.candidate_id]: value }))
            setSelected(null)
          }}
        />
      )}
    </section>
  )
}
