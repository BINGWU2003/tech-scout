import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function KeywordTags({
  keywords,
  onChange,
  id,
}: {
  keywords: string[]
  onChange: (keywords: string[]) => void
  id: string
}) {
  const [text, setText] = useState('')
  const add = () => {
    const value = text.trim()
    if (!value || keywords.length >= 12) return
    onChange([...new Set([...keywords, value])])
    setText('')
  }
  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap gap-2'>
        {keywords.map((keyword, index) => (
          <div
            key={index}
            className='flex max-w-full items-center rounded-md border bg-muted/40 pl-2'
          >
            <input
              aria-label={`关键词 ${index + 1}`}
              className='min-w-0 flex-1 bg-transparent py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
              style={{
                width: `${Math.min(
                  Math.max(
                    [...keyword].reduce(
                      (width, character) =>
                        width + (character.charCodeAt(0) > 127 ? 1 : 0.6),
                      1
                    ),
                    5
                  ),
                  22
                )}em`,
              }}
              value={keyword}
              maxLength={200}
              onChange={(event) =>
                onChange(
                  keywords.map((word, i) =>
                    i === index ? event.target.value : word
                  )
                )
              }
              onBlur={() =>
                onChange([
                  ...new Set(
                    keywords.map((word) => word.trim()).filter(Boolean)
                  ),
                ])
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.preventDefault()
              }}
            />
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='size-8 shrink-0'
              aria-label={`删除关键词 ${index + 1}：${keyword}`}
              onClick={() => onChange(keywords.filter((_, i) => i !== index))}
            >
              <X className='size-3' aria-hidden='true' />
            </Button>
          </div>
        ))}
      </div>
      <div className='flex gap-2'>
        <Input
          id={id}
          aria-label='添加检索关键词'
          placeholder='输入关键词，按回车添加'
          value={text}
          maxLength={200}
          disabled={keywords.length >= 12}
          onChange={(event) => setText(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button
          type='button'
          variant='outline'
          size='icon'
          aria-label='添加关键词'
          disabled={!text.trim() || keywords.length >= 12}
          onClick={add}
        >
          <Plus aria-hidden='true' />
        </Button>
      </div>
      <p className='text-xs leading-5 text-muted-foreground'>
        {keywords.length} / 12 个 ·
        可直接修改标签，支持中文和英文；多个关键词分别检索。
      </p>
    </div>
  )
}
