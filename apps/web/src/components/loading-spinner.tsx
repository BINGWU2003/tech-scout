import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LoadingSpinner({
  className,
  size = 'default',
}: {
  className?: string
  size?: 'default' | 'sm'
}) {
  return (
    <LoaderCircle
      aria-hidden='true'
      className={cn(
        'shrink-0 motion-safe:animate-spin',
        size === 'sm' ? 'size-3.5' : 'size-4',
        className
      )}
    />
  )
}
