import { describe, expect, it } from "vitest"

import {
  getSalesOrderNumberBase,
  suggestNextSalesOrderNumber,
} from "../lib/sales-order-number-series"

describe("sales order number series", () => {
  it("suggests the next suffix after the largest existing suffix", () => {
    expect(
      suggestNextSalesOrderNumber("240019", ["240019", "240019-1", "240019-2"]),
    ).toBe("240019-3")
  })

  it("does not reuse a missing suffix", () => {
    expect(
      suggestNextSalesOrderNumber("240019", ["240019", "240019-1", "240019-3"]),
    ).toBe("240019-4")
  })

  it("finds the same series when the requested number already has a suffix", () => {
    expect(getSalesOrderNumberBase("240019-2")).toBe("240019")
    expect(
      suggestNextSalesOrderNumber("240019-2", ["240019", "240019-1", "240019-2"]),
    ).toBe("240019-3")
  })

  it("ignores similarly prefixed order numbers and non-numeric suffixes", () => {
    expect(
      suggestNextSalesOrderNumber("240019", ["2400199", "240019-A", "240019-7A"]),
    ).toBe("240019-1")
  })
})
