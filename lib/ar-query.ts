// Read a complete customer ledger even when PostgREST caps each response.
// Never present a partial ledger as a customer's full balance.
export async function fetchCompleteArRows<T>(
  makeQuery: () => any,
  label: string,
): Promise<T[]> {
  const rows: T[] = []
  let expectedCount: number | null = null
  while (true) {
    const { data, error, count } = await makeQuery().range(rows.length, rows.length + 499)
    if (error) throw new Error(`${label}讀取失敗，請重新整理：${error.message || "未知錯誤"}`)
    if (!Array.isArray(data) || !Number.isInteger(count) || count < 0) {
      throw new Error(`${label}未回傳完整筆數，請重新整理`)
    }
    if (expectedCount !== null && count !== expectedCount) {
      throw new Error(`${label}讀取期間有資料異動，請重新整理`)
    }
    expectedCount = count
    rows.push(...data)
    if (rows.length === count) return rows
    if (data.length === 0 || rows.length > count) {
      throw new Error(`${label}資料不完整，請重新整理`)
    }
  }
}

type ArOrder = { id: string; customer_cno: string | null; total_amount: number; is_paid: boolean | null }
type ArBalance = { customer_cno?: string | null; amount_due?: number | null; total_amount?: number | null; paid_amount?: number | null }

export function getArOrderBalance(order: ArOrder, existing?: ArBalance) {
  const salesTotal = Number(order.total_amount)
  const storedDue = Number(existing?.amount_due ?? existing?.total_amount ?? salesTotal)
  const amountDue = !Number.isFinite(storedDue) || storedDue <= 0 ? salesTotal : storedDue
  const storedPaid = Number(existing?.paid_amount ?? (order.is_paid ? amountDue : 0))
  let paidAmount = Number.isFinite(storedPaid) ? storedPaid : order.is_paid ? amountDue : 0
  if (order.is_paid && paidAmount <= 0) paidAmount = amountDue
  paidAmount = Math.min(paidAmount, amountDue)
  const customerCode = String(existing?.customer_cno ?? order.customer_cno ?? "").trim().toUpperCase()
  return { amountDue, paidAmount, customerCode }
}

// Group before slicing, so one customer's orders cannot span several pages.
export function paginateArCustomers<T extends ArOrder>(
  orders: T[], balances: Map<string, ArBalance>, requestedPage: number,
  pageSize: number, view: "all" | "unpaid",
) {
  const groups = new Map<string, { orders: T[]; outstanding: number }>()
  for (const order of orders) {
    const { customerCode, amountDue, paidAmount } = getArOrderBalance(order, balances.get(order.id))
    const group = groups.get(customerCode) ?? { orders: [], outstanding: 0 }
    group.orders.push(order)
    group.outstanding += amountDue - paidAmount
    groups.set(customerCode, group)
  }
  const customers = [...groups.entries()]
    .filter(([, group]) => view === "all" || group.outstanding > 0)
    .sort(([a], [b]) => {
      if (!a) return b ? 1 : 0
      if (!b) return -1
      return a.localeCompare(b, "zh-Hant", { numeric: true, sensitivity: "base" }) || a.localeCompare(b)
    })
  const total = customers.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, requestedPage), totalPages)
  return {
    total, totalPages, page,
    orders: customers.slice((page - 1) * pageSize, page * pageSize).flatMap(([, group]) => group.orders),
  }
}
