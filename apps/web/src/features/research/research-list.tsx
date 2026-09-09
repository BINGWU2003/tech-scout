import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { createRequestId } from '@tech-scout/shared'
import { Plus, ArrowUpRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { researchApi } from '@/lib/research-api'
import { ErrorNotice, ResearchShell } from './shared'

export function ResearchList() {
  const query = useQuery({
    queryKey: ['research', 'projects'],
    queryFn: researchApi.projects,
  })
  const [question, setQuestion] = useState('')
  const key = useRef({ question: '', id: createRequestId() })
  const navigate = useNavigate(),
    client = useQueryClient()
  const create = useMutation({
    mutationFn: () => {
      if (key.current.question !== question.trim())
        key.current = { question: question.trim(), id: createRequestId() }
      return researchApi.create({
        requestKey: key.current.id,
        question: question.trim(),
      })
    },
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: ['research', 'projects'] })
      void navigate({
        to: '/research/$projectId',
        params: { projectId: project.id },
      })
    },
  })
  return (
    <ResearchShell>
      <div>
        <h1 className='text-2xl font-bold'>研究工作台</h1>
        <p className='mt-1 text-muted-foreground'>
          输入技术方向，确认检索后采集 Google Patents 中国专利和天眼查企业信息。
        </p>
      </div>
      <ol className='grid gap-3 text-sm sm:grid-cols-4' aria-label='研究流程'>
        {[
          '1 · 输入技术方向',
          '2 · 确认检索计划',
          '3 · 采集专利与企业',
          '4 · 核对身份并分析',
        ].map((step) => (
          <li key={step} className='rounded-lg bg-muted/50 p-3'>
            {step}
          </li>
        ))}
      </ol>
      <form
        className='space-y-3 rounded-xl border bg-card p-5'
        onSubmit={(e) => {
          e.preventDefault()
          if (!create.isPending) create.mutate()
        }}
      >
        <Label htmlFor='research-question'>新建研究</Label>
        <Textarea
          id='research-question'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={2000}
          required
          placeholder='例如：寻找工业视觉质检的边缘推理公司'
          className='min-h-28'
          disabled={create.isPending}
        />
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='text-xs text-muted-foreground'>
            创建后先生成计划，确认后执行筛选。每轮预算独立，重试沿用原预算。
          </p>
          <Button disabled={!question.trim() || create.isPending}>
            <Plus className='size-4' />
            {create.isPending ? '正在创建…' : '开始研究'}
          </Button>
        </div>
        <ErrorNotice error={create.error} />
        {create.isError && (
          <p className='text-xs text-muted-foreground'>
            网络失败时可保持问题不变再次提交，系统会复用本次请求；也可刷新下方列表查看已保存项目。
          </p>
        )}
      </form>
      <div className='flex items-center justify-between'>
        <h2 className='text-lg font-semibold'>最近研究</h2>
        <Button variant='ghost' onClick={() => void query.refetch()}>
          刷新列表
        </Button>
      </div>
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <p role='status'>正在读取研究项目…</p>
      ) : query.data?.length === 0 ? (
        <p className='rounded-xl border border-dashed p-8 text-center text-muted-foreground'>
          还没有研究项目。在上方输入第一个问题。
        </p>
      ) : (
        <div className='grid gap-3'>
          {query.data?.map((p) => (
            <Link
              key={p.id}
              to='/research/$projectId'
              params={{ projectId: p.id }}
              className='flex items-start justify-between gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-accent focus-visible:outline-2'
            >
              <div className='min-w-0'>
                <h3 className='font-medium break-words'>{p.title}</h3>
                <p className='mt-2 text-xs text-muted-foreground'>
                  {new Date(p.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>
              <ArrowUpRight className='size-4 shrink-0' />
            </Link>
          ))}
        </div>
      )}
      <p className='text-xs text-muted-foreground'>
        显示当前账号最近 100 个项目。历史轮次在项目详情中查看。
      </p>
    </ResearchShell>
  )
}
