import { notifyApiError } from './api-error-notifications'

// Imperative callers share the interceptor's deduplication.
export function handleServerError(error: unknown) {
  notifyApiError(error)
}
