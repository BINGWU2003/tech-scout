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
    <ResearchShell
      composer={
        <ResearchComposer
          value={question}
          onChange={setQuestion}
          onSubmit={() => create.mutate()}
          busy={create.isPending}
        />
      }
    >
      <div className='my-auto flex flex-col items-center py-12 text-center'>
        <div className='mb-6 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary'>
          <Sparkles className='size-6' />
        </div>
        <p className='mb-3 text-xs tracking-widest text-muted-foreground'>
          TECH SCOUT
        </p>
        <h1 className='text-3xl font-semibold tracking-tight sm:text-4xl'>
          今天想探索什么技术？
        </h1>
        <p className='mt-4 max-w-md text-sm leading-7 text-muted-foreground'>
          从一个想法开始，拆解技术方向、检索专利，发现相关企业。每一步都有记录和依据。
        </p>
        <div className='mt-8 grid w-full gap-3 sm:grid-cols-2'>
          {[
            '寻找工业视觉质检的边缘推理公司',
            '探索固态电池电解质的技术与企业',
            '研究机器人灵巧手的触觉传感技术',
            '检索近五年的低空飞行避障技术',
          ].map((example) => (
            <Button
              key={example}
              variant='outline'
              className='h-auto justify-start rounded-2xl p-4 text-left text-sm font-normal whitespace-normal'
              onClick={() => setQuestion(example)}
            >
              {example}
            </Button>
          ))}
        </div>
      </div>
    </ResearchShell>
  )
}
