import { useEffect, useRef, useState } from 'react'

const TYPEWRITER_INTERVAL_MS = 20
const TYPEWRITER_TARGET_FRAMES = 60

export function StreamingText({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [displayed, setDisplayed] = useState(() =>
    streaming && !reduceMotion ? '' : text
  )
  const animated = useRef(streaming)

  useEffect(() => {
    if (streaming) animated.current = true
    if (displayed === text) {
      if (!streaming) animated.current = false
      return
    }
    const shouldAnimate =
      !reduceMotion && animated.current && text.startsWith(displayed)
    const target = shouldAnimate ? Array.from(text) : []
    const currentLength = shouldAnimate ? Array.from(displayed).length : 0
    const remaining = target.length - currentLength
    const step = shouldAnimate
      ? Math.min(
          12,
          Math.max(1, Math.ceil(remaining / TYPEWRITER_TARGET_FRAMES))
        )
      : 0
    const timer = window.setTimeout(
      () =>
        setDisplayed(
          shouldAnimate ? target.slice(0, currentLength + step).join('') : text
        ),
      shouldAnimate ? TYPEWRITER_INTERVAL_MS : 0
    )
    return () => window.clearTimeout(timer)
  }, [displayed, reduceMotion, streaming, text])

  const typing = displayed !== text
  return (
    <>
      <span aria-hidden={typing || undefined}>{displayed}</span>
      {typing && <span className='sr-only'>{text}</span>}
      {typing && (
        <span
          aria-hidden='true'
          data-testid='typewriter-cursor'
          className='ml-0.5 inline-block h-[1em] w-px translate-y-[0.15em] bg-current motion-safe:animate-pulse'
        />
      )}
    </>
  )
}
