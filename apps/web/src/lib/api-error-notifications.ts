import {
  clientErrorDefinitions,
  requiresAuthentication,
} from '@tech-scout/contracts'
import { toast } from 'sonner'
import { ApiClientError } from './api-client-error'

type Failure = { sources: Set<string>; id: string }
const failures = new Map<string, Failure>()
let seen = new WeakSet<object>()
let onAuthenticationRequired: (() => void) | undefined
let retryQueries: (() => Promise<unknown>) | undefined
let authenticationNotified = false

export function configureApiErrors(options: {
  onAuthenticationRequired: () => void
  retryQueries: () => Promise<unknown>
}) {
  onAuthenticationRequired = options.onAuthenticationRequired
  retryQueries = options.retryQueries
}

export function recoverApiRequest(source: string) {
  for (const [key, failure] of failures) {
    failure.sources.delete(source)
    if (!failure.sources.size) {
      failures.delete(key)
      toast.dismiss(failure.id)
    }
  }
  if (/ (auth\/me|auth\/login|auth\/register)$/.test(source)) {
    authenticationNotified = false
    const failure = failures.get('reauthenticate')
    if (failure) toast.dismiss(failure.id)
    failures.delete('reauthenticate')
  }
}

export function resetApiErrors() {
  for (const failure of failures.values()) toast.dismiss(failure.id)
  failures.clear()
  seen = new WeakSet()
  authenticationNotified = false
}

export function notifyApiError(error: unknown, manual = false) {
  if (error && typeof error === 'object') {
    if (seen.has(error)) return
    seen.add(error)
  }
  const api = error instanceof ApiClientError ? error : null
  const message = api?.payload.message ?? clientErrorDefinitions.REQUEST_FAILED
  const key =
    api && requiresAuthentication(api.payload)
      ? 'reauthenticate'
      : JSON.stringify([api?.status, api?.payload.code, message])
  const previous = failures.get(key)
  const failure = previous ?? {
    sources: new Set<string>(),
    id: `api-error:${key}`,
  }
  // Request IDs change on every poll and must not participate in deduplication.
  failure.sources.add(api?.source ?? 'unknown')
  for (const [otherKey, other] of failures) {
    if (otherKey === key) continue
    other.sources.delete(api?.source ?? 'unknown')
    if (!other.sources.size) {
      failures.delete(otherKey)
      toast.dismiss(other.id)
    }
  }
  failures.set(key, failure)
  if (
    !previous ||
    manual ||
    (api && api.method !== 'GET' && api.method !== 'HEAD')
  ) {
    toast.error(message, {
      id: failure.id,
      action:
        api?.method === 'GET' &&
        api.payload.retryable !== false &&
        retryQueries &&
        !requiresAuthentication(api.payload)
          ? {
              label: '重试',
              onClick: () => {
                resetApiErrors()
                void retryQueries?.()
              },
            }
          : undefined,
    })
  }
  if (api && requiresAuthentication(api.payload) && !authenticationNotified) {
    authenticationNotified = true
    onAuthenticationRequired?.()
  }
}
