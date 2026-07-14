import { describe, expect, it } from "vitest"

import {
  calculateProductStock,
  fetchAllRows,
  type StockRecalculationInput,
} from "../lib/stock-recalculation"

function baseInput(overrides: Partial<StockRecalculationInput> = {}): StockRecalculationInput {
  return {
    products: [{ code: "A" }],
    purchaseOrders: [],
    purchaseItems: [],
    salesOrders: [],
    salesItems: [],
    purchaseReturns: [],
    purchaseReturnItems: [],
    salesReturns: [],
    salesReturnItems: [],
    ...overrides,
  }
}

describe("calculateProductStock", () => {
  it("uses completed documents and returns to produce the expected stock", () => {
    const result = calculateProductStock(baseInput({
      products: [{ code: "A" }, { code: "B" }],
      purchaseOrders: [
        { id: "p1", order_no: "PO-1", status: "completed" },
        { id: "p2", order_no: "PO-2", status: "cancelled" },
        { id: "p3", order_no: "PO-3", status: "pending" },
        { id: "p4", order_no: "PO-4", status: "COMPLETED" },
      ],
      purchaseItems: [
        { id: "pi1", purchase_order_id: "p1", order_no: "PO-1", code: "a", quantity: 10 },
        { id: "pi2", purchase_order_id: "p2", order_no: "PO-2", code: "missing-cancelled", quantity: -5 },
        { id: "pi3", purchase_order_id: "p3", order_no: "PO-3", code: "A", quantity: 50 },
        { id: "pi4", purchase_order_id: null, order_no: "PO-4", code: "B", quantity: 4 },
      ],
      salesOrders: [
        { id: "s1", order_no: "SO-1", status: "completed" },
        { id: "s2", order_no: "SO-2", status: "cancelled" },
      ],
      salesItems: [
        { id: "si1", sales_order_id: "s1", code: "A", quantity: 3 },
        { id: "si2", sales_order_id: "s2", code: "A", quantity: 100 },
      ],
      purchaseReturns: [
        { id: "pr1", status: "completed" },
        { id: "pr2", status: "cancelled" },
      ],
      purchaseReturnItems: [
        { id: "pri1", purchase_return_id: "pr1", product_id: "A", quantity: 2 },
        { id: "pri2", purchase_return_id: "pr2", product_id: "A", quantity: 100 },
      ],
      salesReturns: [
        { id: "sr1", status: "completed" },
        { id: "sr2", status: "pending" },
      ],
      salesReturnItems: [
        { id: "sri1", sales_return_id: "sr1", product_code: "A", quantity: 1 },
        { id: "sri2", sales_return_id: "sr2", product_code: "A", quantity: 100 },
      ],
    }))

    expect(result.updates).toEqual([
      { code: "A", stock_qty: 6, purchase_qty_total: 10 },
      { code: "B", stock_qty: 4, purchase_qty_total: 4 },
    ])
    expect(result.stats).toEqual({
      products: 2,
      completedPurchaseItems: 2,
      completedSalesItems: 1,
      completedPurchaseReturnItems: 1,
      completedSalesReturnItems: 1,
    })
  })

  it("aborts on an invalid completed movement instead of treating it as zero", () => {
    expect(() => calculateProductStock(baseInput({
      salesOrders: [{ id: "s1", order_no: "SO-1", status: "completed" }],
      salesItems: [{ id: "bad", sales_order_id: "s1", code: "A", quantity: "not-a-number" }],
    }))).toThrow(/數量必須是大於 0 的有效數字/)
  })

  it("aborts before preparing updates when a movement is orphaned", () => {
    expect(() => calculateProductStock(baseInput({
      salesItems: [{ id: "orphan", sales_order_id: "missing", code: "A", quantity: 1 }],
    }))).toThrow(/參照不存在的銷貨單/)
  })

  it("rejects case-insensitive duplicate product codes", () => {
    expect(() => calculateProductStock(baseInput({ products: [{ code: "A" }, { code: " a " }] })))
      .toThrow(/忽略大小寫後重複/)
  })
})

function paginatedClient(rows: unknown[], counts: Array<number | null> = []) {
  const ranges: Array<[number, number]> = []
  let requestIndex = 0
  return {
    ranges,
    client: {
      from() {
        return {
          select() {
            return {
              order() {
                return {
                  async range(from: number, to: number) {
                    ranges.push([from, to])
                    const count = requestIndex < counts.length ? counts[requestIndex] : rows.length
                    requestIndex += 1
                    return { data: rows.slice(from, to + 1), error: null, count }
                  },
                }
              },
            }
          },
        }
      },
    },
  }
}

describe("fetchAllRows", () => {
  it("keeps requesting pages until the exact count is reached", async () => {
    const { client, ranges } = paginatedClient([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }])
    const rows = await fetchAllRows<{ id: number }>(client, {
      table: "sample",
      select: "id",
      orderBy: "id",
      label: "讀取測試資料",
      pageSize: 2,
    })

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }])
    expect(ranges).toEqual([[0, 1], [2, 3], [4, 5]])
  })

  it("keeps paging without a count until an empty page", async () => {
    const { client, ranges } = paginatedClient([{ id: 1 }, { id: 2 }, { id: 3 }], [null, null, null])
    const rows = await fetchAllRows<{ id: number }>(client, {
      table: "sample",
      select: "id",
      orderBy: "id",
      label: "讀取測試資料",
      pageSize: 2,
    })

    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(ranges).toEqual([[0, 1], [2, 3], [3, 4]])
  })

  it("rejects a table that changes between pages", async () => {
    const { client } = paginatedClient([{ id: 1 }, { id: 2 }, { id: 3 }], [3, 4])
    await expect(fetchAllRows(client, {
      table: "sample",
      select: "id",
      orderBy: "id",
      label: "讀取測試資料",
      pageSize: 2,
    })).rejects.toThrow(/資料筆數發生變動/)
  })
})
