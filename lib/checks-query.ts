export type CheckStatusFilter = "all" | "pending" | "overdue" | "cleared" | "bounced"

export function parseChecksListParams(
  searchParams: any,
  pageSize: number,
): { page: number; searchText: string; statusText: CheckStatusFilter; from: number; to: number } {
  let page = 1
  let searchText = ""
  let statusText: CheckStatusFilter = "all"

  if (searchParams && typeof searchParams === "object") {
    const rawPage = searchParams.page
    const parsed = Number(Array.isArray(rawPage) ? rawPage[0] : rawPage)
    if (!Number.isNaN(parsed) && parsed > 0) page = parsed

    const rawSearch = searchParams.search
    if (rawSearch) searchText = Array.isArray(rawSearch) ? rawSearch[0] : rawSearch

    const rawStatus = searchParams.status
    const candidateStatus = Array.isArray(rawStatus) ? rawStatus[0] : rawStatus
    if (candidateStatus === "pending" || candidateStatus === "overdue" || candidateStatus === "cleared" || candidateStatus === "bounced") {
      statusText = candidateStatus
    }
  }

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  return { page, searchText, statusText, from, to }
}

export function applyServerStatusFilter(
  query: any,
  statusText: CheckStatusFilter,
  statusTag: string,
): any {
  if (statusText === "all") return query

  const today = new Date().toISOString().slice(0, 10)

  if (statusText === "bounced") {
    return query.ilike("notes", `%${statusTag}%|bounced%`)
  }

  if (statusText === "cleared") {
    return query.eq("status", "paid")
  }

  if (statusText === "pending") {
    return query
      .neq("status", "paid")
      .or(`due_date.is.null,due_date.gte.${today}`)
      .not("notes", "ilike", `%${statusTag}%|bounced%`)
  }

  if (statusText === "overdue") {
    return query
      .neq("status", "paid")
      .lt("due_date", today)
      .not("notes", "ilike", `%${statusTag}%|bounced%`)
  }

  return query
}
