import { describe, expect, it } from "vitest"
import { consumeFifo, seedInferredOpeningBatch, type FifoBatch } from "../lib/products"

describe("商品 FIFO 成本", () => {
  it("先用期初庫存補足歷史缺口，讓七月銷售使用剩餘的 576 元批次", () => {
    const batches: FifoBatch[] = [
      { orderedAt: "2026-02-03", remainingQty: 138, landedUnitCost: 570 },
      { orderedAt: "2026-04-13", remainingQty: 1165, landedUnitCost: 576 },
    ]

    expect(seedInferredOpeningBatch(batches, 1378, 576)).toBe(75)

    consumeFifo(batches, 1104)
    const julyCogs = consumeFifo(batches, 274)

    expect(julyCogs).toBe(274 * 576)
  })

  it("進貨數量足夠時不建立期初批次", () => {
    const batches: FifoBatch[] = [
      { orderedAt: "2026-01-01", remainingQty: 500, landedUnitCost: 500 },
      { orderedAt: "2026-07-01", remainingQty: 500, landedUnitCost: 576 },
    ]

    expect(seedInferredOpeningBatch(batches, 900, 576)).toBe(0)
    expect(batches).toHaveLength(2)
  })
})
