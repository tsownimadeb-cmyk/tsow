import { describe, expect, it } from "vitest"
import { fetchCompleteArRows, paginateArCustomers } from "../lib/ar-query"

describe("complete receivable customer ledgers", () => {
  it("continues past the server row cap until all orders have been read", async () => {
    const orders = Array.from({ length: 1152 }, (_, id) => ({ id }))
    const offsets: number[] = []
    const actual = await fetchCompleteArRows(() => ({
      range: async (from: number) => {
        offsets.push(from)
        return { data: orders.slice(from, from + 100), count: orders.length, error: null }
      },
    }), "客戶單據")
    expect(actual).toEqual(orders)
    expect(offsets).toHaveLength(12)
  })

  it("rejects a failed later batch rather than showing fewer orders", async () => {
    await expect(fetchCompleteArRows(() => ({
      range: async (from: number) => from === 0
        ? { data: [{ id: 1 }], count: 2, error: null }
        : { data: null, count: null, error: { message: "connection lost" } },
    }), "客戶單據")).rejects.toThrow("connection lost")
  })

  it("rejects a changing count during pagination", async () => {
    await expect(fetchCompleteArRows(() => ({
      range: async (from: number) => ({ data: [{ id: from }], count: from === 0 ? 2 : 3, error: null }),
    }), "客戶單據")).rejects.toThrow("資料異動")
  })

  it("rejects a truncated response even when no query error is returned", async () => {
    await expect(fetchCompleteArRows(() => ({
      range: async () => ({ data: [], count: 2, error: null }),
    }), "客戶單據")).rejects.toThrow("資料不完整")
  })

  it("accepts an empty complete ledger", async () => {
    expect(await fetchCompleteArRows(() => ({
      range: async () => ({ data: [], count: 0, error: null }),
    }), "客戶單據")).toEqual([])
  })
})

describe("receivable customer pagination", () => {
  const order = (id: string, customer: string | null) => ({
    id, customer_cno: customer, total_amount: 100, is_paid: false,
  })

  it("keeps a customer's many orders on one page and fills 20 customer slots", () => {
    const orders = [
      ...Array.from({ length: 45 }, (_, i) => order(`many-${i}`, "A001")),
      ...Array.from({ length: 24 }, (_, i) => order(`single-${i}`, `A${String(i + 2).padStart(3, "0")}`)),
    ]
    const first = paginateArCustomers(orders, new Map(), 1, 20, "unpaid")
    const second = paginateArCustomers(orders, new Map(), 2, 20, "unpaid")
    expect(first).toMatchObject({ total: 25, totalPages: 2, page: 1 })
    expect(new Set(first.orders.map((o) => o.customer_cno)).size).toBe(20)
    expect(first.orders.filter((o) => o.customer_cno === "A001")).toHaveLength(45)
    expect(new Set(second.orders.map((o) => o.customer_cno)).size).toBe(5)
    const firstCustomers = new Set(first.orders.map((o) => o.customer_cno))
    expect(second.orders.every((o) => !firstCustomers.has(o.customer_cno))).toBe(true)
    expect(paginateArCustomers([...orders].reverse(), new Map(), 1, 20, "unpaid").orders.map((o) => o.id).sort())
      .toEqual(first.orders.map((o) => o.id).sort())
  })

  it("excludes fully settled customers before counting pages", () => {
    const orders = [order("paid", "A001"), order("unpaid", "A002")]
    const balances = new Map([["paid", { amount_due: 100, paid_amount: 100 }]])
    const result = paginateArCustomers(orders, balances, 1, 1, "unpaid")
    expect(result).toMatchObject({ total: 1, totalPages: 1, orders: [orders[1]] })
    expect(paginateArCustomers(orders, balances, 1, 1, "all").total).toBe(2)
  })

  it("groups normalized and effective customer codes, including walk-in customers", () => {
    const orders = [order("1", " a001 "), order("2", "A001"), order("3", "old"), order("4", null), order("5", "")]
    const balances = new Map([["3", { customer_cno: "A001" }]])
    const first = paginateArCustomers(orders, balances, 1, 1, "all")
    expect(first.total).toBe(2)
    expect(first.orders.map((o) => o.id)).toEqual(["1", "2", "3"])
    expect(paginateArCustomers(orders, balances, 2, 1, "all").orders.map((o) => o.id)).toEqual(["4", "5"])
  })

  it("clamps old page links after filtering and supports an empty result", () => {
    expect(paginateArCustomers([order("1", "A001")], new Map(), 58, 20, "unpaid"))
      .toMatchObject({ page: 1, totalPages: 1, total: 1 })
    expect(paginateArCustomers([], new Map(), 58, 20, "unpaid"))
      .toMatchObject({ page: 1, totalPages: 1, total: 0, orders: [] })
  })
})
