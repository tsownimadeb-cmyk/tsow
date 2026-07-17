export type ProductBulkPriceUpdate = Partial<{
  base_price: number
  price: number
  sale_price: number
}>

type ParsedBulkPriceRequest =
  | { ok: true; codes: string[]; prices: ProductBulkPriceUpdate }
  | { ok: false; message: string }

const PRICE_FIELDS = ["base_price", "price", "sale_price"] as const

export function parseProductBulkPriceRequest(body: unknown): ParsedBulkPriceRequest {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "批量更新資料格式不正確" }
  }

  const record = body as { codes?: unknown; prices?: unknown }
  if (!Array.isArray(record.codes)) {
    return { ok: false, message: "請選擇要更新的商品" }
  }

  const codes = Array.from(
    new Set(record.codes.map((code) => String(code || "").trim()).filter(Boolean)),
  )
  if (codes.length === 0) {
    return { ok: false, message: "請選擇要更新的商品" }
  }
  if (codes.length > 100) {
    return { ok: false, message: "一次最多更新 100 項商品" }
  }

  if (!record.prices || typeof record.prices !== "object") {
    return { ok: false, message: "請至少輸入一項價格" }
  }

  const inputPrices = record.prices as Record<string, unknown>
  const prices: ProductBulkPriceUpdate = {}
  for (const field of PRICE_FIELDS) {
    if (inputPrices[field] === undefined) continue
    const value = inputPrices[field]
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return { ok: false, message: "價格必須是大於或等於 0 的數字" }
    }
    prices[field] = value
  }

  if (Object.keys(prices).length === 0) {
    return { ok: false, message: "請至少輸入一項價格" }
  }

  return { ok: true, codes, prices }
}
