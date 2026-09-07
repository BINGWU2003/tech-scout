import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  researchProgressViewSchema,
  type ResearchProgressView,
} from '@tech-scout/contracts'
import { useEffect, useRef, useState } from 'react'
import { researchApi } from '@/lib/research-api'

export const isExecuting = (status?: string) =>
  status === 'queued' || status === 'running'
export function useResearchRun(id: string) {
  const client = useQueryClient()
  const [disconnected, setDisconnected] = useState(false)
  const summary = useQuery({
    queryKey: ['research', id, 'summary'],
    queryFn: () => researchApi.summary(id),
    refetchInterval: (q) => (isExecuting(q.state.data?.status) ? 5000 : false),
  })
  const active = isExecuting(summary.data?.status)
  const events = useQuery({
    queryKey: ['research', id, 'events'],
    queryFn: () => researchApi.events(id),
    staleTime: 0,
  })
  const cursor = useRef(0)
  const ready = events.isSuccess
  useEffect(() => {
    if (!active || !ready) return
    const existing =
      client.getQueryData<ResearchProgressView[]>(['research', id, 'events']) ??
      []
    cursor.current = Math.max(
      cursor.current,
      ...existing.map((e) => e.sequence)
    )
    const stream = new EventSource(
      `/api/v1/research/ui/runs/${encodeURIComponent(id)}/stream?after=${cursor.current}`,
      { withCredentials: true }
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    stream.onopen = () => setDisconnected(false)
    stream.onerror = () => setDisconnected(true) // EventSource reconnects with Last-Event-ID; summary polling remains available.
    stream.onmessage = (event) => {
      let value: unknown
      try {
        value = JSON.parse(event.data)
      } catch {
        setDisconnected(true)
        return
      }
      const parsed = researchProgressViewSchema.safeParse(value)
      if (!parsed.success || parsed.data.sequence <= cursor.current) return
      const progress = parsed.data
      cursor.current = progress.sequence
      client.setQueryData<ResearchProgressView[]>(
        ['research', id, 'events'],
        (old) =>
          [
            ...(old ?? []).filter((e) => e.sequence < progress.sequence),
            progress,
          ].slice(-100)
      )
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined
          void client.invalidateQueries({
            queryKey: ['research', id, 'summary'],
          })
        }, 600)
    }
    return () => {
      stream.close()
      clearTimeout(timer)
    }
  }, [id, active, ready, client])
  return { summary, events, disconnected }
}
