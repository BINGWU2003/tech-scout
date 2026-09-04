import { useCallback, useEffect, useRef } from 'react'

export function useDebouncedCallback<Arguments extends unknown[]>(
  callback: (...arguments_: Arguments) => void,
  delay: number
) {
  const callbackRef = useRef(callback)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  const cancel = useCallback(() => {
    if (timeoutRef.current !== undefined) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  }, [])

  const run = useCallback(
    (...arguments_: Arguments) => {
      cancel()
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = undefined
        callbackRef.current(...arguments_)
      }, delay)
    },
    [cancel, delay]
  )

  useEffect(() => cancel, [cancel])

  return { cancel, run }
}
