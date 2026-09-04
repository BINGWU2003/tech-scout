import { useLocation, useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { type ZodType } from 'zod'

function compactCatalogSearch<Query extends object>(
  query: Query,
  defaultQuery: Query
): Partial<Query> {
  return Object.fromEntries(
    Object.entries(query).filter(
      ([key, value]) =>
        value !== undefined &&
        !Object.is(value, defaultQuery[key as keyof Query])
    )
  ) as Partial<Query>
}

export function createCatalogSearchValidator<Query extends object>(
  schema: ZodType<Query>
) {
  const defaultQuery = schema.parse({})

  return (search: unknown): Partial<Query> => {
    const parsed = schema.safeParse(search)
    return compactCatalogSearch(
      parsed.success ? parsed.data : defaultQuery,
      defaultQuery
    )
  }
}

export function useCatalogQueryState<Query extends object>(
  schema: ZodType<Query>
) {
  const navigate = useNavigate()
  const search = useLocation({ select: (location) => location.search })
  const defaultQuery = useMemo(() => schema.parse({}), [schema])
  const query = useMemo(() => {
    const parsed = schema.safeParse(search)
    return parsed.success ? parsed.data : defaultQuery
  }, [defaultQuery, schema, search])

  const updateQuery = useCallback(
    (patch: Partial<Query>) => {
      const nextQuery = schema.parse({ ...query, ...patch })
      const nextSearch = compactCatalogSearch(nextQuery, defaultQuery)
      void navigate({ search: nextSearch as never })
    },
    [defaultQuery, navigate, query, schema]
  )

  return { query, updateQuery }
}
