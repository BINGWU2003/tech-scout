import { Link } from '@tanstack/react-router'
import { type ResearchSourceView } from '@tech-scout/contracts'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'

export function ResearchShell({
  children,
  composer,
  navigation,
  title = '技术研究',
  split = false,
}: {
  children: ReactNode
  composer?: ReactNode
  navigation?: ReactNode
  title?: string
  split?: boolean
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(false)
  const [showLatest, setShowLatest] = useState(false)
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (following.current && viewport.current)
        viewport.current.scrollTop = viewport.current.scrollHeight
    })
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <Header className='shrink-0 border-b bg-background'>
        <Link
          to='/research'
          className='me-auto min-w-0 truncate text-sm font-medium'
          title={title}
        >
          {title}
        </Link>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main fixed fluid className='relative min-h-0 p-0'>
        {navigation && (
          <div className='shrink-0 border-b px-4 py-3 sm:px-6'>
            {navigation}
          </div>
        )}
        <div
          ref={viewport}
          className={
            split
              ? 'flex min-h-0 flex-1 flex-col overflow-y-auto md:overflow-hidden'
              : 'min-h-0 flex-1 overflow-y-auto overscroll-contain'
          }
          onScroll={(event) => {
            const el = event.currentTarget
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100
            setShowLatest(!following.current)
          }}
        >
          <div
            ref={content}
            className={
              split
                ? 'flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-6'
                : 'mx-auto flex min-h-full w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6'
            }
          >
            {children}
          </div>
        </div>
        {!split && showLatest && (
          <Button
            size='sm'
            variant='secondary'
            className='absolute right-5 bottom-48 shadow'
            onClick={() => {
              following.current = true
              viewport.current?.scrollTo({
                top: viewport.current.scrollHeight,
                behavior: 'smooth',
              })
            }}
          >
            回到最新 ↓
          </Button>
        )}
        {composer && (
          <div className='shrink-0 bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6'>
            <div className='mx-auto max-w-3xl'>{composer}</div>
          </div>
        )}
      </Main>
    </>
  )
}
export function SourceReference({ source }: { source: ResearchSourceView }) {
  return (
    <dl className='mt-2 grid gap-1 text-xs break-all text-muted-foreground'>
      {source.url && (
        <div>
          <dt className='inline'>来源网页：</dt>
          <dd className='inline'>
            <a
              href={source.url}
              target='_blank'
              rel='noreferrer'
              className='underline'
            >
              打开原始资料
            </a>
          </dd>
        </div>
      )}

      <div>
        <dt className='inline font-medium'>SHA-256：</dt>
        <dd className='inline'>{source.sha256 ?? '未提供'}</dd>
      </div>
    </dl>
  )
}
export function Pager({
  page,
  total,
  pageSize = 20,
  onChange,
}: {
  page: number
  total: number
  pageSize?: number
  onChange: (p: number) => void
}) {
  return (
    <div className='flex items-center justify-between gap-3 text-sm'>
      <span>
        共 {total} 项 · 第 {page} / {Math.max(1, Math.ceil(total / pageSize))}{' '}
        页
      </span>
      <div className='flex gap-2'>
        <Button
          variant='outline'
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          variant='outline'
          disabled={page * pageSize >= total}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
