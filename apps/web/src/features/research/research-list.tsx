import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createRequestId } from '@tech-scout/shared'
import { Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { researchApi } from '@/lib/research-api'
import { ResearchComposer } from './research-composer'
import { ResearchShell } from './shared'

export function ResearchList() {
  const [question, setQuestion] = useState('')
  const [thinking, setThinking] = useState(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const key = useRef({ question: '', id: createRequestId() })
  const navigate = useNavigate(),
    client = useQueryClient()
  const create = useMutation({
    mutationFn: () => {
      const signature = JSON.stringify([question.trim(), thinking])
      if (key.current.question !== signature)
        key.current = { question: signature, id: createRequestId() }
      return researchApi.create({
        requestKey: key.current.id,
        question: question.trim(),
        thinking,
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
    <ResearchShell
      composer={
        <ResearchComposer
          inputRef={inputRef}
          value={question}
          onChange={setQuestion}
          onSubmit={() => create.mutate()}
          busy={create.isPending}
          thinking={thinking}
          onThinkingChange={setThinking}
        />
      }
    >
      <div className='my-auto flex flex-col items-center py-6 text-center sm:py-10'>
        <div className='mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary'>
          <Sparkles className='size-6' />
        </div>
        <p className='mb-3 text-xs tracking-widest text-muted-foreground'>
          TECH SCOUT
        </p>
        <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
          今天想探索什么技术？
        </h1>
        <p className='mt-3 max-w-md text-sm leading-6 text-muted-foreground'>
          从一个想法开始，拆解技术方向、检索专利，发现相关企业。每一步都有记录和依据。
        </p>
        <ol
          aria-label='研究流程概览'
          className='mt-7 grid w-full grid-cols-4 gap-1.5 text-[11px] sm:gap-3 sm:text-xs'
        >
          {['确认计划', '检索专利', '发现企业', '查看报告'].map(
            (step, index) => (
              <li
                key={step}
                className='rounded-lg border bg-muted/30 px-1 py-2 font-medium sm:px-3'
              >
                <span className='mr-1 text-primary'>{index + 1}.</span>
                {step}
              </li>
            )
          )}
        </ol>
        <div className='mt-8 w-full text-left'>
          <h2 className='text-sm font-semibold'>从示例开始</h2>
          <p className='mt-1 text-xs text-muted-foreground'>
            选择一个问题后，可在下方编辑并发送。
          </p>
        </div>
        <div className='mt-3 grid w-full gap-3 sm:grid-cols-2'>
          {[
            '寻找工业视觉质检的边缘推理公司',
            '探索固态电池电解质的技术与企业',
            '研究机器人灵巧手的触觉传感技术',
            '检索近五年的低空飞行避障技术',
          ].map((example) => (
            <Button
              key={example}
              variant='outline'
              className='h-auto min-h-16 justify-start rounded-xl p-4 text-left text-sm font-normal whitespace-normal hover:border-primary/40 hover:bg-primary/5'
              onClick={() => {
                setQuestion(example)
                inputRef.current?.focus()
              }}
            >
              {example}
            </Button>
          ))}
        </div>
      </div>
    </ResearchShell>
  )
}
