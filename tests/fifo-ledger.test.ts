import { describe, expect, it } from "vitest"

import { calculateFifoSaleCosts, resolveFifoPurchaseUnitCost } from "../lib/fifo-ledger"

describe("FIFO ledger", () => {
  it("uses a confirmed override for a historical zero-cost purchase", () => {
    expect(resolveFifoPurchaseUnitCost(0, 471)).toBe(471)
    expect(resolveFifoPurchaseUnitCost(570, null)).toBe(570)
  })

  it("matches the user's mixed-batch example", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [
        { orderedAt: "2026-07-01", quantity: 100, unitCost: 400 },
        { orderedAt: "2026-07-02", quantity: 100, unitCost: 420 },
      ],
      sales: [
        { id: "first", orderedAt: "2026-07-01", quantity: 60 },
        { id: "second", orderedAt: "2026-07-02", quantity: 50 },
      ],
    })

    expect(result.get("first")).toEqual({ cogs: 24_000, unknownQty: 0, provisionalQty: 0 })
    expect(result.get("second")).toEqual({ cogs: 20_200, unknownQty: 0, provisionalQty: 0 })
  })

  it("uses purchases before sales on the same business date", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-07-01", quantity: 100, unitCost: 576 }],
      sales: [{ id: "sale", orderedAt: "2026-07-01", quantity: 100 }],
    })

    expect(result.get("sale")).toEqual({ cogs: 57_600, unknownQty: 0, provisionalQty: 0 })
  })

  it("treats a zero-cost purchase as a confirmed free-goods batch", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-07-01", quantity: 10, unitCost: 0 }],
      sales: [{ id: "gift-sale", orderedAt: "2026-07-02", quantity: 10 }],
    })

    expect(result.get("gift-sale")).toEqual({ cogs: 0, unknownQty: 0, provisionalQty: 0 })
  })

  it("uses the remaining free batch before the paid batch", () => {
    const paidUnitCost = 58.62037037037037
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [
        { orderedAt: "2026-08-11", quantity: 600, unitCost: 0 },
        { orderedAt: "2026-08-11", quantity: 200, unitCost: paidUnitCost },
      ],
      sales: [
        { id: "earlier-sales", orderedAt: "2026-08-26", quantity: 382 },
        { id: "target-sale", orderedAt: "2026-08-28", quantity: 300 },
      ],
    })

    expect(result.get("target-sale")?.unknownQty).toBe(0)
    expect(result.get("target-sale")?.provisionalQty).toBe(0)
    expect(result.get("target-sale")?.cogs).toBeCloseTo(82 * paidUnitCost, 6)
  })

  it("uses a later-entered purchase to settle an earlier negative sale", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-07-03", quantity: 100, unitCost: 576 }],
      sales: [{ id: "sale", orderedAt: "2026-07-01", quantity: 100 }],
    })

    expect(result.get("sale")).toEqual({ cogs: 57_600, unknownQty: 0, provisionalQty: 0 })
  })

  it("uses the last known cost provisionally while inventory remains negative", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-07-01", quantity: 10, unitCost: 500 }],
      sales: [{ id: "sale", orderedAt: "2026-07-02", quantity: 15 }],
    })

    expect(result.get("sale")).toEqual({ cogs: 7_500, unknownQty: 0, provisionalQty: 5 })
  })

  it("uses a configured fallback when there is no earlier receipt", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      fallbackUnitCost: 400,
      purchases: [],
      sales: [{ id: "sale", orderedAt: "2026-07-02", quantity: 3 }],
    })

    expect(result.get("sale")).toEqual({ cogs: 1_200, unknownQty: 0, provisionalQty: 3 })
  })

  it("keeps only the unmatched remainder provisional after a partial later receipt", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-07-03", quantity: 6, unitCost: 600 }],
      sales: [{ id: "sale", orderedAt: "2026-07-01", quantity: 10 }],
    })

    expect(result.get("sale")).toEqual({ cogs: 6_000, unknownQty: 0, provisionalQty: 4 })
  })

  it("consumes unknown opening stock first without leaking it into July", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 105,
      purchases: [
        { orderedAt: "2026-02-03", quantity: 138, unitCost: 570 },
        { orderedAt: "2026-04-13", quantity: 985, unitCost: 576 },
        { orderedAt: "2026-07-03", quantity: 180, unitCost: 576 },
      ],
      sales: [
        { id: "before-july", orderedAt: "2026-06-30", quantity: 1_104 },
        { id: "july", orderedAt: "2026-07-18", quantity: 274 },
      ],
    })

    expect(result.get("before-july")?.unknownQty).toBe(105)
    expect(result.get("july")).toEqual({ cogs: 157_824, unknownQty: 0, provisionalQty: 0 })
  })

  it("uses a confirmed cost for opening FIFO inventory", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 105,
      openingUnitCost: 576,
      purchases: [{ orderedAt: "2026-04-13", quantity: 985, unitCost: 576 }],
      sales: [{ id: "opening-sale", orderedAt: "2026-01-01", quantity: 105 }],
    })

    expect(result.get("opening-sale")).toEqual({ cogs: 60_480, unknownQty: 0, provisionalQty: 0 })
  })

  it("restores a sales return at the original sale FIFO cost", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-04-01", quantity: 10, unitCost: 500 }],
      sales: [
        { id: "original", orderedAt: "2026-04-08", quantity: 10 },
        { id: "resold", orderedAt: "2026-05-06", quantity: 3 },
      ],
      returns: [{ id: "returned", originalSaleId: "original", orderedAt: "2026-05-05", quantity: 3 }],
    })

    expect(result.get("returned")).toEqual({ cogs: 1_500, unknownQty: 0, provisionalQty: 0 })
    expect(result.get("resold")).toEqual({ cogs: 1_500, unknownQty: 0, provisionalQty: 0 })
  })

  it("keeps returned free goods at a confirmed zero FIFO cost", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-04-01", quantity: 10, unitCost: 0 }],
      sales: [
        { id: "original", orderedAt: "2026-04-08", quantity: 10 },
        { id: "resold", orderedAt: "2026-05-06", quantity: 3 },
      ],
      returns: [{ id: "returned", originalSaleId: "original", orderedAt: "2026-05-05", quantity: 3 }],
    })

    expect(result.get("returned")).toEqual({ cogs: 0, unknownQty: 0, provisionalQty: 0 })
    expect(result.get("resold")).toEqual({ cogs: 0, unknownQty: 0, provisionalQty: 0 })
  })

  it("keeps a return unresolved when the original sale cost was incomplete", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [],
      sales: [{ id: "original", orderedAt: "2026-04-08", quantity: 3 }],
      returns: [{ id: "returned", originalSaleId: "original", orderedAt: "2026-05-05", quantity: 3 }],
    })

    expect(result.get("returned")).toEqual({ cogs: 0, unknownQty: 3, provisionalQty: 0 })
  })

  it("treats a dated inventory increase as a FIFO batch from that date", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-07-26", quantity: 7, unitCost: 360 }],
      sales: [
        { id: "before-adjustment", orderedAt: "2026-07-25", quantity: 1 },
        { id: "after-adjustment", orderedAt: "2026-07-27", quantity: 2 },
      ],
    })

    expect(result.get("before-adjustment")).toEqual({ cogs: 360, unknownQty: 0, provisionalQty: 0 })
    expect(result.get("after-adjustment")).toEqual({ cogs: 720, unknownQty: 0, provisionalQty: 0 })
  })
})
