import { GripVertical, MessageSquare, Shapes } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { useIsMobile } from '@/hooks/use-mobile'

export function ResearchPlanLayout({
  directions,
  conversation,
  composer,
}: {
  directions: ReactNode
  conversation: ReactNode
  composer?: ReactNode
}) {
  const mobile = useIsMobile()
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'research-plan-layout-v1',
    onlySaveAfterUserInteractions: true,
  })
  const viewport = useRef<HTMLDivElement>(null)
  const messages = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (following.current && viewport.current)
        viewport.current.scrollTop = viewport.current.scrollHeight
    })
    if (messages.current) observer.observe(messages.current)
    return () => observer.disconnect()
  }, [mobile])

  const directionPane = (
    <section
      aria-label='技术方向'
      className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card'
    >
      <div className='flex shrink-0 items-center gap-2 border-b px-5 py-4'>
        <Shapes className='size-4 text-muted-foreground' aria-hidden='true' />
        <h2 className='text-sm font-semibold'>技术方向</h2>
      </div>
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4'>
        {directions}
      </div>
    </section>
  )
  const conversationPane = (
    <section
      aria-label='AI 对话'
      className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card'
    >
      <div className='flex shrink-0 items-center gap-2 border-b px-5 py-4'>
        <MessageSquare
          className='size-4 text-muted-foreground'
          aria-hidden='true'
        />
        <h2 className='text-sm font-semibold'>AI 对话</h2>
        {!mobile && (
          <span className='ml-auto text-xs text-muted-foreground'>
            拖动分隔线调整宽度
          </span>
        )}
      </div>
      <div
        ref={viewport}
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain'
        onScroll={(event) => {
          const el = event.currentTarget
          following.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 100
        }}
      >
        <div ref={messages} className='space-y-5 p-4'>
          {conversation}
        </div>
      </div>
      {composer && (
        <div className='shrink-0 border-t bg-background p-3'>{composer}</div>
      )}
    </section>
  )
  if (mobile)
    return (
      <div className='space-y-4 pb-4'>
        {directionPane}
        <div className='h-[36rem]'>{conversationPane}</div>
      </div>
    )
  return (
    <Group
      orientation='horizontal'
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      id='research-plan-layout'
      className='min-h-0 flex-1'
    >
      <Panel id='directions' defaultSize='55%' minSize='30%'>
        {directionPane}
      </Panel>
      <Separator
        aria-label='调整方向与 AI 对话宽度'
        className='group flex w-4 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-ring'
      >
        <span className='flex h-9 w-3 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary'>
          <GripVertical className='h-4 w-3' aria-hidden='true' />
        </span>
      </Separator>
      <Panel id='conversation' defaultSize='45%' minSize='30%'>
        {conversationPane}
      </Panel>
    </Group>
  )
}
