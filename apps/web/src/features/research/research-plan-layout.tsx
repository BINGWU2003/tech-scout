import {
  ArrowDown,
  ChartNoAxesCombined,
  GripVertical,
  FileText,
  MessageSquare,
  Search,
  Shapes,
} from 'lucide-react'
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
} from 'react-resizable-panels'
import { Button } from '@/components/ui/button'

const COMPACT_QUERY = '(max-width: 1023px)'
const ActionBarContext = createContext<HTMLElement | null | undefined>(
  undefined
)

function subscribeCompact(callback: () => void) {
  const media = window.matchMedia(COMPACT_QUERY)
  media.addEventListener('change', callback)
  return () => media.removeEventListener('change', callback)
}

function getCompactSnapshot() {
  return window.matchMedia(COMPACT_QUERY).matches
}

function useCompactLayout() {
  return useSyncExternalStore(subscribeCompact, getCompactSnapshot, () => false)
}

export function ResearchActionBar({ children }: { children: ReactNode }) {
  const target = useContext(ActionBarContext)
  if (target === undefined) return children
  return target ? createPortal(children, target) : null
}

export function ResearchPlanLayout({
  directions,
  footerActions,
  footerHint,
  conversation,
  composer,
  variant = 'plan',
  detailKey,
  autoFollow = true,
  initialPane,
}: {
  footerActions?: ReactNode
  footerHint?: string
  directions: ReactNode
  conversation: ReactNode
  composer?: ReactNode
  variant?: 'plan' | 'patents' | 'companies' | 'report'
  detailKey?: string | null
  autoFollow?: boolean
  initialPane?: 'conversation' | 'directions'
}) {
  const mobile = useCompactLayout()
  const patents = variant === 'patents'
  const canScrollToBottom = patents || variant === 'plan'
  const companies = variant === 'companies'
  const report = variant === 'report'
  const results = patents || companies || report
  const leftTitle = report
    ? '报告概览与企业名单'
    : companies
      ? '企业查询结果'
      : patents
        ? '专利概览'
        : '已选方向'
  const rightTitle = report
    ? '企业分析与依据'
    : companies
      ? '发现记录与解析依据'
      : patents
        ? '专利搜索记录'
        : 'AI 对话'
  const LeftIcon = results ? ChartNoAxesCombined : Shapes
  const RightIcon = report ? FileText : results ? Search : MessageSquare
  const [mobilePane, setMobilePane] = useState<'conversation' | 'directions'>(
    initialPane ?? (results ? 'directions' : 'conversation')
  )
  const previousMobile = useRef(mobile)
  useEffect(() => {
    if (mobile && !previousMobile.current && variant === 'plan')
      setMobilePane('conversation')
    previousMobile.current = mobile
  }, [mobile, variant])
  const previousInitialPane = useRef(initialPane)
  useEffect(() => {
    if (
      mobile &&
      previousInitialPane.current === 'conversation' &&
      initialPane === 'directions'
    )
      setMobilePane('directions')
    previousInitialPane.current = initialPane
  }, [initialPane, mobile])
  const [actionBarTarget, setActionBarTarget] = useState<HTMLDivElement | null>(
    null
  )
  const [previousDetail, setPreviousDetail] = useState(detailKey)
  if (previousDetail !== detailKey) {
    setPreviousDetail(detailKey)
    if (detailKey) setMobilePane('conversation')
    else if (companies) setMobilePane('directions')
  }
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: `research-${variant}-layout-v1`,
    onlySaveAfterUserInteractions: true,
  })
  const viewport = useRef<HTMLDivElement>(null)
  const messages = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (autoFollow && following.current && viewport.current)
        viewport.current.scrollTop = viewport.current.scrollHeight
      const el = viewport.current
      if (canScrollToBottom && el)
        setShowScrollToBottom(
          el.scrollHeight - el.scrollTop - el.clientHeight > 200
        )
    })
    if (messages.current) observer.observe(messages.current)
    if (viewport.current) observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [mobile, autoFollow, canScrollToBottom])
  useEffect(() => {
    if (detailKey) {
      viewport.current?.scrollTo({ top: 0 })
    }
  }, [detailKey])

  const directionPane = (
    <section
      aria-label={leftTitle}
      className='flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card'
    >
      <div className='flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-4'>
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
      <div className='relative min-h-0 flex-1'>
        <div
          ref={viewport}
          className='h-full overflow-y-auto overscroll-contain'
          onScroll={(event) => {
            const el = event.currentTarget
            const distance = el.scrollHeight - el.scrollTop - el.clientHeight
            following.current = distance < 100
            if (canScrollToBottom) setShowScrollToBottom(distance > 200)
          }}
        >
          <div ref={messages} className='space-y-5 p-4'>
            {conversation}
          </div>
        </div>
        {canScrollToBottom && showScrollToBottom && (
          <Button
            size='sm'
            variant='outline'
            className='absolute right-4 bottom-4 z-10 rounded-full shadow-md'
            onClick={() => {
              const el = viewport.current
              if (!el) return
              following.current = true
              el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
              setShowScrollToBottom(false)
            }}
          >
            <ArrowDown className='size-4' aria-hidden='true' />
            回到底部
          </Button>
        )}
      </div>
      {composer && (
        <div
          className={
            results
              ? 'max-h-[45%] shrink-0 overflow-y-auto border-t bg-background p-3'
              : 'shrink-0 border-t bg-background p-3'
          }
        >
          {composer}
        </div>
      )}
    </section>
  )
  const panes = mobile ? (
    <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-hidden'>
      <div className='flex shrink-0 gap-2' aria-label='切换研究面板'>
        <Button
          size='sm'
          variant={mobilePane === 'conversation' ? 'default' : 'outline'}
          aria-pressed={mobilePane === 'conversation'}
          onClick={() => setMobilePane('conversation')}
        >
          {report ? '依据' : patents ? '搜索记录' : rightTitle}
        </Button>
        <Button
          size='sm'
          variant={mobilePane === 'directions' ? 'default' : 'outline'}
          aria-pressed={mobilePane === 'directions'}
          onClick={() => setMobilePane('directions')}
        >
          {report ? '报告' : results ? leftTitle : '已选计划'}
        </Button>
      </div>
      <div
        className={mobilePane === 'directions' ? 'min-h-0 flex-1' : 'hidden'}
      >
        {directionPane}
      </div>
      <div
        className={mobilePane === 'conversation' ? 'min-h-0 flex-1' : 'hidden'}
      >
        {conversationPane}
      </div>
    </div>
  ) : (
    <Group
      orientation='horizontal'
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      id={`research-${variant}-layout`}
      className='min-h-0 flex-1'
    >
      <Panel id='directions' defaultSize='64%' minSize='40%'>
        {directionPane}
      </Panel>
      <Separator
        aria-label={
          report
            ? '调整报告与分析依据宽度'
            : companies
              ? '调整企业概览与主体依据宽度'
              : patents
                ? '调整专利概览与搜索记录宽度'
                : '调整方向与 AI 对话宽度'
        }
        className='group flex w-4 shrink-0 items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-ring'
      >
        <span className='flex h-9 w-3 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary'>
          <GripVertical className='h-4 w-3' aria-hidden='true' />
        </span>
      </Separator>
      <Panel id='conversation' defaultSize='36%' minSize='25%'>
        {conversationPane}
      </Panel>
    </Group>
  )
  return (
    <ActionBarContext.Provider value={actionBarTarget}>
      <div className='flex min-h-0 flex-1 flex-col gap-3 overflow-hidden'>
        {panes}
        {(variant === 'plan' || footerActions || footerHint) && (
          <div className='flex shrink-0 flex-col items-stretch gap-2 rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3'>
            <div className='min-w-0'>
              <p className='text-xs font-semibold text-primary'>
                {report ? '阅读提示' : '下一步'}
              </p>
              {footerHint && (
                <p className='mt-0.5 text-xs leading-5 text-muted-foreground'>
                  {footerHint}
                </p>
              )}
            </div>
            <div
              ref={setActionBarTarget}
              className='flex min-w-0 flex-wrap items-center justify-end gap-2 sm:flex-1'
            >
              {footerActions}
            </div>
          </div>
        )}
      </div>
    </ActionBarContext.Provider>
  )
}
