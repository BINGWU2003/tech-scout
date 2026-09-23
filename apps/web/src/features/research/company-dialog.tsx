import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function CompanyDialog({
  title,
  description,
  close,
  returnFocus,
  navigation,
  children,
  contentKey,
  fullscreenMobile = false,
}: {
  title: string
  description: string
  close: () => void
  returnFocus?: () => void
  navigation?: ReactNode
  children: ReactNode
  contentKey?: string
  fullscreenMobile?: boolean
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent
        className={cn(
          'flex h-[88dvh] max-h-[900px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]',
          fullscreenMobile &&
            'h-dvh max-h-dvh max-w-none rounded-none border-0 sm:h-[88dvh] sm:max-h-[900px] sm:max-w-[960px] sm:rounded-lg sm:border'
        )}
        onCloseAutoFocus={
          returnFocus
            ? (event) => {
                event.preventDefault()
                returnFocus()
              }
            : undefined
        }
      >
        <DialogHeader
          className={cn(
            'shrink-0 border-b px-5 py-5 pr-12 text-left sm:px-7 sm:pr-12',
            fullscreenMobile &&
              'pt-[max(1.25rem,env(safe-area-inset-top))] sm:pt-5'
          )}
        >
          <DialogTitle className='line-clamp-3 text-lg leading-7 break-words'>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div
          key={contentKey}
          className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7'
        >
          {children}
        </div>
        <div className='flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7 sm:pb-4'>
          {navigation}
          <Button variant='outline' onClick={close}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CompanyNavigation({
  ids,
  selected,
  select,
  total,
  hasNextPage = false,
  loadMore,
  disabled = false,
}: {
  ids: string[]
  selected: string
  select: (id: string) => void
  total: number
  hasNextPage?: boolean
  loadMore?: () => Promise<string[]>
  disabled?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const index = ids.indexOf(selected)
  async function next() {
    if (ids[index + 1]) {
      setError(false)
      select(ids[index + 1])
      return
    }
    if (!loadMore || loading) return
    setLoading(true)
    setError(false)
    try {
      const loaded = await loadMore()
      if (active.current && loaded[index + 1]) select(loaded[index + 1])
    } catch {
      if (active.current) setError(true)
    } finally {
      if (active.current) setLoading(false)
    }
  }
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        variant='outline'
        size='sm'
        disabled={disabled || loading || index <= 0}
        onClick={() => {
          setError(false)
          select(ids[index - 1])
        }}
      >
        上一家
      </Button>
      <span className='text-xs text-muted-foreground tabular-nums'>
        {index + 1} / {total} 家
      </span>
      <Button
        variant='outline'
        size='sm'
        disabled={
          disabled ||
          loading ||
          index < 0 ||
          (index === ids.length - 1 && !hasNextPage)
        }
        onClick={() => void next()}
      >
        {loading ? '加载中…' : '下一家'}
      </Button>
      {error && (
        <span role='alert' className='text-xs text-destructive'>
          加载失败，请点击下一家重试。
        </span>
      )}
    </div>
  )
}
