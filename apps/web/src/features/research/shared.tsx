import { Link } from '@tanstack/react-router'
import { type ResearchSourceView } from '@tech-scout/contracts'
import { type ReactNode } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { ApiClientError } from '@/lib/api-client-error'

export function ResearchShell({ children }: { children: ReactNode }) {
  return (
    <>
      <Header fixed>
        <Link to='/research' className='me-auto font-semibold'>
          技术研究
        </Link>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>{children}</Main>
    </>
  )
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  if (!error) return null
  return (
    <div
      role='alert'
      className='rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm'
    >
      <p>{error instanceof Error ? error.message : '请求失败，请稍后重试'}</p>
      {error instanceof ApiClientError && error.status === 401 ? (
        <a className='mt-2 inline-block underline' href='/sign-in'>
          登录状态失效，请重新登录
        </a>
      ) : (
        retry && (
          <Button variant='outline' className='mt-2' onClick={retry}>
            重新读取
          </Button>
        )
      )}
    </div>
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
