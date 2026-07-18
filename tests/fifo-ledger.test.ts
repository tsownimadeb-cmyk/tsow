import { describe, expect, it } from "vitest"

import { calculateFifoSaleCosts } from "../lib/fifo-ledger"

describe("FIFO ledger", () => {
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

    expect(result.get("first")).toEqual({ cogs: 24_000, unknownQty: 0 })
    expect(result.get("second")).toEqual({ cogs: 20_200, unknownQty: 0 })
  })

  it("uses purchases before sales on the same business date", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-07-01", quantity: 100, unitCost: 576 }],
      sales: [{ id: "sale", orderedAt: "2026-07-01", quantity: 100 }],
    })

    expect(result.get("sale")).toEqual({ cogs: 57_600, unknownQty: 0 })
  })

  it("does not borrow a future purchase for an earlier sale", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 0,
      purchases: [{ orderedAt: "2026-07-03", quantity: 100, unitCost: 576 }],
      sales: [{ id: "sale", orderedAt: "2026-07-01", quantity: 100 }],
    })

    expect(result.get("sale")).toEqual({ cogs: 0, unknownQty: 100 })
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
    expect(result.get("july")).toEqual({ cogs: 157_824, unknownQty: 0 })
  })

  it("uses a confirmed cost for opening FIFO inventory", () => {
    const result = calculateFifoSaleCosts({
      openingQty: 105,
      openingUnitCost: 576,
      purchases: [{ orderedAt: "2026-04-13", quantity: 985, unitCost: 576 }],
      sales: [{ id: "opening-sale", orderedAt: "2026-01-01", quantity: 105 }],
    })

    expect(result.get("opening-sale")).toEqual({ cogs: 60_480, unknownQty: 0 })
  })
})
