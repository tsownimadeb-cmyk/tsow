import { describe, expect, it } from "vitest"
import { parseProductBulkPriceRequest } from "../lib/product-bulk-prices"

describe("parseProductBulkPriceRequest", () => {
  it("接受多個商品與部分價格欄位", () => {
    expect(parseProductBulkPriceRequest({
      codes: ["A110", "A111", "A110"],
      prices: { base_price: 10, sale_price: 15 },
    })).toEqual({
      ok: true,
      codes: ["A110", "A111"],
      prices: { base_price: 10, sale_price: 15 },
    })
  })

  it("拒絕沒有選取商品或沒有價格的請求", () => {
    expect(parseProductBulkPriceRequest({ codes: [], prices: { price: 20 } }).ok).toBe(false)
    expect(parseProductBulkPriceRequest({ codes: ["A110"], prices: {} }).ok).toBe(false)
  })

  it("拒絕負數、非數字及未允許的欄位", () => {
    expect(parseProductBulkPriceRequest({ codes: ["A110"], prices: { price: -1 } }).ok).toBe(false)
    expect(parseProductBulkPriceRequest({ codes: ["A110"], prices: { price: "20" } }).ok).toBe(false)
    expect(parseProductBulkPriceRequest({ codes: ["A110"], prices: { stock_qty: 999 } }).ok).toBe(false)
  })
})
