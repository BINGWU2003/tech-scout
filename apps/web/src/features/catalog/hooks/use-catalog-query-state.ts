import { useLocation, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo } from 'react'
import { type ZodType } from 'zod'

type CatalogHistoryState = {
  catalogQuery?: unknown
}

export function useCatalogQueryState<Query extends object>(
  schema: ZodType<Query>
) {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const locationState = useLocation({ select: (location) => location.state })
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const storedQuery = (locationState as CatalogHistoryState).catalogQuery
  const defaultQuery = useMemo(() => schema.parse({}), [schema])
  const query = useMemo(() => {
    if (searchStr) return defaultQuery
    const parsed = schema.safeParse(storedQuery)
    return parsed.success ? parsed.data : defaultQuery
  }, [defaultQuery, schema, searchStr, storedQuery])

  useEffect(() => {
    if (!searchStr) return
    void navigate({
      href: pathname,
      replace: true,
      state: (previous) => ({
        ...previous,
        catalogQuery: defaultQuery,
      }),
    })
  }, [defaultQuery, navigate, pathname, searchStr])

  const updateQuery = useCallback(
    (patch: Partial<Query>) => {
      const nextQuery = schema.parse({ ...query, ...patch })
      void navigate({
        href: pathname,
        replace: true,
        state: (previous) => ({
          ...previous,
          catalogQuery: nextQuery,
        }),
      })
    },
    [navigate, pathname, query, schema]
  )

  return { query, updateQuery }
}
