export function nextCompanyListPage(page: {
  items: unknown[]
  page: number
  pageSize: number
  total: number
}) {
  return page.items.length > 0 && page.page * page.pageSize < page.total
    ? page.page + 1
    : undefined
}
