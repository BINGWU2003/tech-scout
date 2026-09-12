import { LoaderCircle } from 'lucide-react'
import { type ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export function PageLoading() {
  return (
    <div className='flex min-h-svh w-full items-center justify-center bg-background/95 p-6'>
      <LoadingIndicator label='正在打开页面…' />
    </div>
  )
}

export function LoadingIndicator({
  label = '正在加载…',
  className,
}: {
  label?: string
  className?: string
}) {
  return (
    <div
      role='status'
      className={cn(
        'flex items-center justify-center gap-2 text-sm text-muted-foreground',
        className
      )}
    >
      <LoaderCircle
        aria-hidden='true'
        className='size-4 shrink-0 motion-safe:animate-spin'
      />
      <span>{label}</span>
    </div>
  )
}

/** Only explicit user-driven updates block this region; polling stays interactive. */
export function LoadingRegion({
  busy,
  children,
  className,
  label = '正在更新…',
}: {
  busy: boolean
  children: ReactNode
  className?: string
  label?: string
}) {
  return (
    <div className={cn('relative isolate min-w-0', className)}>
      <div className='contents' inert={busy} aria-busy={busy}>
        {children}
      </div>
      {busy && (
        <div className='absolute inset-0 z-10 cursor-wait rounded-[inherit] bg-background/75'>
          <div className='sticky top-0 flex h-full max-h-[60svh] min-h-24 items-center justify-center p-4'>
            <LoadingIndicator
              label={label}
              className='rounded-lg border bg-background px-4 py-3 shadow-sm'
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function ContentSkeleton({
  variant = 'detail',
  label = '正在加载…',
  className,
}: {
  variant?: 'sidebar' | 'list' | 'detail' | 'workspace' | 'chart'
  label?: string
  className?: string
}) {
  return (
    <div
      role='status'
      aria-label={label}
      className={cn('w-full min-w-0', className)}
    >
      <span className='sr-only'>{label}</span>
      <div
        aria-hidden='true'
        className={cn('space-y-4', variant === 'sidebar' ? 'p-2' : 'py-4')}
      >
        {variant === 'sidebar' ? (
          Array.from({ length: 5 }, (_, index) => (
            <div key={index} className='flex h-9 items-center gap-3'>
              <Skeleton className='size-4 shrink-0' />
              <Skeleton className={cn('h-3', index % 2 ? 'w-3/5' : 'w-4/5')} />
            </div>
          ))
        ) : variant === 'list' ? (
          Array.from({ length: 4 }, (_, index) => (
            <div key={index} className='space-y-3 rounded-lg border p-4'>
              <Skeleton className='h-4 w-2/5' />
              <Skeleton className='h-3 w-4/5' />
              <Skeleton className='h-3 w-3/5' />
            </div>
          ))
        ) : (
          <>
            <Skeleton className='h-6 w-2/5 max-w-64' />
            {variant !== 'chart' && (
              <div className='grid gap-3 sm:grid-cols-2'>
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className='space-y-3 rounded-lg border p-4'>
                    <Skeleton className='h-3 w-1/2' />
                    <Skeleton className='h-5 w-3/4' />
                  </div>
                ))}
              </div>
            )}
            {variant === 'chart' ? (
              <Skeleton className='h-64 w-full rounded-lg' />
            ) : (
              <div
                className={cn(
                  'space-y-4 rounded-lg border p-5',
                  variant === 'workspace' ? 'min-h-64' : 'min-h-40'
                )}
              >
                <Skeleton className='mb-6 h-4 w-1/3' />
                <Skeleton className='h-3 w-full' />
                <Skeleton className='h-3 w-11/12' />
                <Skeleton className='h-3 w-4/5' />
                <Skeleton className='h-3 w-3/5' />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function TableSkeletonRows({
  columns,
  rows = 6,
}: {
  columns: number
  rows?: number
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <TableRow key={row} aria-hidden={row === 0 ? undefined : true}>
          {Array.from({ length: columns }, (_, column) => (
            <TableCell key={column} className='h-16'>
              {row === 0 && column === 0 && (
                <span role='status' className='sr-only'>
                  正在加载表格…
                </span>
              )}
              <Skeleton
                aria-hidden='true'
                className={cn(
                  'h-4',
                  column === columns - 1 ? 'w-8' : row % 2 ? 'w-3/5' : 'w-4/5'
                )}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}
