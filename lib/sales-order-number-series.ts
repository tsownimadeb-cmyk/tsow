export function getSalesOrderNumberBase(orderNumber: string) {
  return String(orderNumber || "").trim().replace(/-\d+$/, "")
}

export function suggestNextSalesOrderNumber(requestedOrderNumber: string, existingOrderNumbers: string[]) {
  const base = getSalesOrderNumberBase(requestedOrderNumber)
  if (!base) return ""

  let highestSuffix = 0

  for (const existingOrderNumber of existingOrderNumbers) {
    const normalized = String(existingOrderNumber || "").trim()
    if (normalized === base) continue
    if (!normalized.startsWith(`${base}-`)) continue

    const suffixText = normalized.slice(base.length + 1)
    if (!/^\d+$/.test(suffixText)) continue

    const suffix = Number(suffixText)
    if (Number.isSafeInteger(suffix) && suffix > highestSuffix) {
      highestSuffix = suffix
    }
  }

  return `${base}-${highestSuffix + 1}`
}

