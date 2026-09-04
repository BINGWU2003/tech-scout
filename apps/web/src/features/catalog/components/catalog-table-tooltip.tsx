import { type ReactElement } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function CatalogTableTooltip({
  children,
  content,
}: {
  children: ReactElement
  content: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className='max-w-sm break-words' sideOffset={4}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
