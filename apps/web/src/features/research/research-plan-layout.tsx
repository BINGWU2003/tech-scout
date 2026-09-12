import {
  ChartNoAxesCombined,
  GripVertical,
  MessageSquare,
  Search,
  Shapes,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { Button } from '@/components/ui/button'
import { useIsMobile } from '@/hooks/use-mobile'

export function ResearchPlanLayout({
  directions,
  conversation,
  composer,
  variant = 'plan',
}: {
  directions: ReactNode
  conversation: ReactNode
  composer?: ReactNode
  variant?: 'plan' | 'patents'
}) {
  const mobile = useIsMobile()
  const patents = variant === 'patents'
  const leftTitle = patents ? '专利概览' : '已选方向'
  const rightTitle = patents ? '专利搜索记录' : 'AI 对话'
  const LeftIcon = patents ? ChartNoAxesCombined : Shapes
  const RightIcon = patents ? Search : MessageSquare
  const [mobilePane, setMobilePane] = useState<'conversation' | 'directions'>(
    patents ? 'directions' : 'conversation'
  )
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `research-${variant}-layout-v1`,
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
      aria-label={leftTitle}
      className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card'
    >
      <div className='flex shrink-0 items-center gap-2 border-b px-5 py-4'>
        <LeftIcon className='size-4 text-muted-foreground' aria-hidden='true' />
        <h2 className='text-sm font-semibold'>{leftTitle}</h2>
      </div>
      <div className='min-h-0 flex-1 overflow-hidden'>{directions}</div>
    </section>
  )
  const conversationPane = (
    <section
      aria-label={rightTitle}
      className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card'
    >
      <div className='flex shrink-0 items-center gap-2 border-b px-5 py-4'>
        <RightIcon
          className='size-4 text-muted-foreground'
          aria-hidden='true'
        />
        <h2 className='text-sm font-semibold'>{rightTitle}</h2>
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
        <div
          className={
            patents
              ? 'max-h-[45%] shrink-0 overflow-y-auto border-t bg-background p-3'
              : 'shrink-0 border-t bg-background p-3'
          }
        >
          {composer}
        </div>
      )}
    </section>
  )
  if (mobile)
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-hidden'>
        <div className='flex shrink-0 gap-2' aria-label='切换研究面板'>
          <Button
            size='sm'
            variant={mobilePane === 'conversation' ? 'default' : 'outline'}
            aria-pressed={mobilePane === 'conversation'}
            onClick={() => setMobilePane('conversation')}
          >
            {patents ? '搜索记录' : rightTitle}
          </Button>
          <Button
            size='sm'
            variant={mobilePane === 'directions' ? 'default' : 'outline'}
            aria-pressed={mobilePane === 'directions'}
            onClick={() => setMobilePane('directions')}
          >
            {patents ? leftTitle : '已选计划'}
          </Button>
        </div>
        <div
          className={mobilePane === 'directions' ? 'min-h-0 flex-1' : 'hidden'}
        >
          {directionPane}
        </div>
        <div
          className={
            mobilePane === 'conversation' ? 'min-h-0 flex-1' : 'hidden'
          }
        >
          {conversationPane}
        </div>
      </div>
    )
  return (
    <Group
      orientation='horizontal'
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      id={`research-${variant}-layout`}
      className='min-h-0 flex-1'
    >
      <Panel id='directions' defaultSize='55%' minSize='30%'>
        {directionPane}
      </Panel>
      <Separator
        aria-label={
          patents ? '调整专利概览与搜索记录宽度' : '调整方向与 AI 对话宽度'
        }
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
