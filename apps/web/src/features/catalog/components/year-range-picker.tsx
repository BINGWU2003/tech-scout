import { CalendarRange, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const MIN_YEAR = 2000
const MAX_YEAR = 2030
const YEARS_PER_PAGE = 12

function getPageStart(year: number) {
  const clampedYear = Math.min(Math.max(year, MIN_YEAR), MAX_YEAR)
  return (
    MIN_YEAR +
    Math.floor((clampedYear - MIN_YEAR) / YEARS_PER_PAGE) * YEARS_PER_PAGE
  )
}

type YearRangePickerProps = {
  fromYear?: number
  toYear?: number
  onChange: (range: { fromYear?: number; toYear?: number }) => void
}

function getRangeLabel(fromYear?: number, toYear?: number) {
  if (fromYear && toYear) return `${fromYear} – ${toYear}`
  if (fromYear) return `${fromYear} 年起`
  if (toYear) return `截至 ${toYear} 年`
  return '授权年份'
}

export function YearRangePicker({
  fromYear,
  toYear,
  onChange,
}: YearRangePickerProps) {
  const label = getRangeLabel(fromYear, toYear)
  const [pageStart, setPageStart] = useState(() =>
    getPageStart(fromYear ?? toYear ?? new Date().getFullYear())
  )
  const pageEnd = Math.min(pageStart + YEARS_PER_PAGE - 1, MAX_YEAR)
  const years = Array.from(
    { length: pageEnd - pageStart + 1 },
    (_, index) => pageStart + index
  )

  const selectYear = (year: number) => {
    if (fromYear === undefined || toYear !== undefined) {
      onChange({ fromYear: year })
      return
    }

    onChange(
      year < fromYear
        ? { fromYear: year, toYear: fromYear }
        : { fromYear, toYear: year }
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className={cn(
            'w-40 justify-start font-normal',
            !fromYear && !toYear && 'text-muted-foreground'
          )}
          size='sm'
          type='button'
          variant='outline'
          aria-label={
            fromYear === undefined && toYear === undefined
              ? '授权年份'
              : `授权年份：${label}`
          }
        >
          <CalendarRange className='size-4' />
          <span className='truncate'>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-72' align='start'>
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <Button
              size='icon'
              type='button'
              variant='ghost'
              className='size-8'
              aria-label='上一组年份'
              disabled={pageStart <= MIN_YEAR}
              onClick={() =>
                setPageStart((current) => current - YEARS_PER_PAGE)
              }
            >
              <ChevronLeft className='size-4' />
            </Button>
            <div className='text-sm font-medium tabular-nums'>
              {pageStart}–{pageEnd}
            </div>
            <Button
              size='icon'
              type='button'
              variant='ghost'
              className='size-8'
              aria-label='下一组年份'
              disabled={pageEnd >= MAX_YEAR}
              onClick={() =>
                setPageStart((current) => current + YEARS_PER_PAGE)
              }
            >
              <ChevronRight className='size-4' />
            </Button>
          </div>
          <div
            className='grid grid-cols-3 gap-1'
            role='group'
            aria-label='选择年份范围'
          >
            {years.map((year) => {
              const isEndpoint = year === fromYear || year === toYear
              const isInRange =
                fromYear !== undefined &&
                toYear !== undefined &&
                year > fromYear &&
                year < toYear

              return (
                <Button
                  key={year}
                  className={cn(
                    'h-8 px-2 font-normal tabular-nums',
                    isInRange && 'bg-accent text-accent-foreground'
                  )}
                  type='button'
                  variant={isEndpoint ? 'default' : 'ghost'}
                  aria-label={`选择 ${year} 年`}
                  aria-pressed={isEndpoint}
                  onClick={() => selectYear(year)}
                >
                  {year}
                </Button>
              )
            })}
          </div>
          <div className='text-center text-xs text-muted-foreground'>
            {fromYear === undefined
              ? '请选择起始年份'
              : toYear === undefined
                ? '请选择结束年份'
                : `${fromYear} 至 ${toYear}`}
          </div>
          <Button
            className='w-full'
            disabled={fromYear === undefined && toYear === undefined}
            size='sm'
            type='button'
            variant='ghost'
            onClick={() => onChange({})}
          >
            <X className='size-4' />
            清除年份
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
