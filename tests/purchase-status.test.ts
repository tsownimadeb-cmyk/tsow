import { describe, expect, it } from "vitest"

import {
  CONFIRMED_PURCHASE_STATUS,
  isCompletedPurchaseStatus,
  purchaseStatusForSave,
} from "../lib/purchase-status"

describe("purchase order status", () => {
  it("always saves a purchase as completed", () => {
    expect(purchaseStatusForSave()).toBe(CONFIRMED_PURCHASE_STATUS)
    expect(purchaseStatusForSave()).toBe("completed")
  })

  it("only lets completed purchases enter FIFO", () => {
    expect(isCompletedPurchaseStatus("completed")).toBe(true)
    expect(isCompletedPurchaseStatus(" Completed ")).toBe(true)
    expect(isCompletedPurchaseStatus("pending")).toBe(false)
    expect(isCompletedPurchaseStatus("draft")).toBe(false)
    expect(isCompletedPurchaseStatus(null)).toBe(false)
  })
})
