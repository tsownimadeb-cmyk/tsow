import { describe, expect, it } from "vitest"
import { fetchSalesRows } from "../lib/sales"
import { filterSalesOrders } from "../lib/sales-search"
import type { SalesOrder } from "../lib/types"

const products = [
  { code: "P001", name: "原味麥片" },
  { code: "P002", name: "巧克力麥片" },
  { code: "P003", name: "牛奶" },
]
const customers = [{ code: "C001", name: "王先生" }, { code: "C002", name: "麥片商店" }]

function sale(id: string, code: string | null, customer = "C001"): SalesOrder {
  return {
    id,
    order_no: `SO-${id}`,
    customer_cno: customer,
    order_date: "2026-10-07",
    total_amount: 100,
    status: "completed",
    is_paid: false,
    notes: null,
    created_at: "2026-10-07T00:00:00Z",
    updated_at: "2026-10-07T00:00:00Z",
    items: [{ id: `item-${id}`, sales_order_id: id, code, quantity: 1, unit_price: 100, subtotal: 100, created_at: "" }],
  }
}

describe("cached sales product search", () => {
  const sales = [sale("1", "P001"), sale("2", "P003", "C002"), sale("3", "P002", "C002"), sale("4", null)]

  it("finds names in order items, excluding matching customer names and notes", () => {
    const rows = sales.map((row) => ({ ...row, notes: "麥片" }))
    expect(filterSalesOrders(rows, customers, products, "", " 麥片 ").map((row) => row.id)).toEqual(["1", "3"])
  })

  it("combines customer and product search as an intersection", () => {
    expect(filterSalesOrders(sales, customers, products, "王先生", "麥片").map((row) => row.id)).toEqual(["1"])
    expect(filterSalesOrders(sales, customers, products, "SO-3", "麥片").map((row) => row.id)).toEqual(["3"])
  })

  it("supports product codes and restoring the list when search is cleared", () => {
    expect(filterSalesOrders(sales, customers, products, "", "p002").map((row) => row.id)).toEqual(["3"])
    expect(filterSalesOrders(sales, customers, products, "", "不存在")).toEqual([])
    expect(filterSalesOrders(sales, customers, products, "", "")).toEqual(sales)
  })

  it("supports cached sales_order_items and product_pno fields", () => {
    const row = sale("legacy", null)
    row.sales_order_items = row.items!.map((item) => ({ ...item, product_pno: "P001" }))
    delete row.items
    expect(filterSalesOrders([row], customers, products, "", "麥片")).toEqual([row])
  })

  it("searches orders beyond the first page", () => {
    const rows = Array.from({ length: 25 }, (_, i) => sale(String(i), "P003"))
    rows.push(sale("matching", "P001"))
    expect(filterSalesOrders(rows, customers, products, "", "麥片").map((row) => row.id)).toEqual(["matching"])
  })
})

// Simulate the API's row cap, filtering and pagination, rather than returning canned results.
function database(tables: Record<string, Record<string, any>[]>, errorTable?: string) {
  return {
    from(table: string) {
      let rows = [...(tables[table] || [])]
      let from = 0
      let to = 999
      let exactCount = false
      const query = {
        select(_fields: string, options?: { count?: string }) { exactCount = options?.count === "exact"; return query },
        or(expression: string) {
          const filters = expression.match(/\w+\.in\.\([^)]*\)|\w+\.ilike\.[^,]+/g) || []
          rows = rows.filter((row) => filters.some((filter) => {
            const [column, operator, ...parts] = filter.split(".")
            const value = parts.join(".")
            if (operator === "in") return value.slice(1, -1).split(",").map((code) => code.replaceAll('"', "")).includes(String(row[column]))
            return String(row[column] ?? "").toLowerCase().includes(value.replace(/^%|%$/g, "").toLowerCase())
          }))
          return query
        },
        in(column: string, values: string[]) { rows = rows.filter((row) => values.includes(row[column])); return query },
        order(column: string, options?: { ascending?: boolean }) {
          rows.sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (options?.ascending === false ? -1 : 1))
          return query
        },
        limit(limit: number) { to = limit - 1; return query },
        range(start: number, end: number) { from = start; to = end; return query },
        then(resolve: (result: unknown) => unknown) {
          return Promise.resolve({
            data: table === errorTable ? null : rows.slice(from, Math.min(to + 1, from + 1000)),
            count: exactCount ? rows.length : null,
            error: table === errorTable ? { message: "query failed" } : null,
          }).then(resolve)
        },
      }
      return query
    },
  }
}

describe("online sales product search", () => {
  function fixtures(rows: SalesOrder[], productRows = products) {
    return { products: productRows, customers, sales_orders: rows, sales_order_items: rows.flatMap((row) => row.items || []) }
  }

  it("returns only orders containing matching products with all their detail items", async () => {
    const row = sale("1", "P001")
    row.items!.push(...sale("extra", "P003").items!.map((item) => ({ ...item, sales_order_id: "1" })))
    const result = await fetchSalesRows(database(fixtures([row, sale("2", "P003")])), 0, 19, "", "麥片")
    expect(result.totalCount).toBe(1)
    expect(result.rows.map((row) => row.id)).toEqual(["1"])
    expect(result.rows[0].items).toHaveLength(2)
    expect(result.warning).toBeNull()
  })

  it("does not miss matching products after the old 200-product limit or an API page", async () => {
    const manyProducts = Array.from({ length: 1001 }, (_, i) => ({ code: `P${String(i).padStart(4, "0")}`, name: "原味麥片" }))
    const result = await fetchSalesRows(database(fixtures([sale("last", "P1000"), sale("unrelated", "OTHER")], manyProducts)), 0, 19, "", "麥片")
    expect(result.totalCount).toBe(1)
    expect(result.rows.map((row) => row.id)).toEqual(["last"])
  })

  it("deduplicates orders, applies both searches and paginates after filtering", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => sale(String(i).padStart(2, "0"), "P001"))
    for (const row of rows) row.items!.push(...sale(`${row.id}-other`, "P002").items!.map((item) => ({ ...item, sales_order_id: row.id })))
    rows.push(sale("other-customer", "P001", "C002"), sale("other-product", "P003"))
    const result = await fetchSalesRows(database(fixtures(rows)), 20, 39, "王先生", "麥片")
    expect(result.totalCount).toBe(25)
    expect(result.rows).toHaveLength(5)
    expect(result.rows.every((row) => row.customer_cno === "C001")).toBe(true)
  })

  it("supports product code search and no matches", async () => {
    const db = database(fixtures([sale("1", "P001"), sale("2", "P003")]))
    expect((await fetchSalesRows(db, 0, 19, "", "P003")).rows.map((row) => row.id)).toEqual(["2"])
    expect(await fetchSalesRows(db, 0, 19, "", "不存在")).toEqual({ rows: [], totalCount: 0, warning: null })
  })

  it("reports a product query failure instead of claiming search succeeded", async () => {
    const result = await fetchSalesRows(database(fixtures([sale("1", "P001")]), "products"), 0, 19, "", "麥片")
    expect(result.warning).toBe("query failed")
  })
})
