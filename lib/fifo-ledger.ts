export type FifoPurchase = {
  orderedAt: string
  quantity: number
  unitCost: number
}

export type FifoSale = {
  id: string
  orderedAt: string
  quantity: number
}

export type FifoReturn = {
  id: string
  orderedAt: string
  quantity: number
  originalSaleId: string
}

export type FifoSaleCost = {
  cogs: number
  unknownQty: number
  provisionalQty: number
}

type WorkingBatch = {
  remainingQty: number
  unitCost: number | null
}

const positiveNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

const nonNegativeNumberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export const resolveFifoPurchaseUnitCost = (calculatedUnitCost: unknown, confirmedOverride: unknown) => {
  const override = positiveNumber(confirmedOverride)
  return override > 0 ? override : positiveNumber(calculatedUnitCost)
}

/**
 * Matches sales to inventory available on the business date.
 * Opening inventory is oldest and can carry a confirmed historical cost. When
 * that cost is missing it remains unresolved. Purchases on the same date are
 * available before sales. A later-recorded receipt first repairs the oldest
 * negative sale; any shortage that remains uses a provisional fallback cost.
 */
export function calculateFifoSaleCosts(input: {
  openingQty: number
  openingUnitCost?: number | null
  fallbackUnitCost?: number | null
  purchases: FifoPurchase[]
  sales: FifoSale[]
  returns?: FifoReturn[]
}): Map<string, FifoSaleCost> {
  const purchases = input.purchases
    .map((purchase) => ({
      orderedAt: String(purchase.orderedAt || ""),
      quantity: positiveNumber(purchase.quantity),
      unitCost: nonNegativeNumberOrNull(purchase.unitCost),
    }))
    .filter((purchase) => purchase.quantity > 0)
    .sort((left, right) => left.orderedAt.localeCompare(right.orderedAt))

  const sales = input.sales
    .map((sale, index) => ({
      id: String(sale.id || `sale-${index}`),
      orderedAt: String(sale.orderedAt || ""),
      quantity: positiveNumber(sale.quantity),
      index,
    }))
    .filter((sale) => sale.quantity > 0)
    .sort((left, right) => left.orderedAt.localeCompare(right.orderedAt) || left.index - right.index)

  const returns = (input.returns ?? [])
    .map((returned, index) => ({
      id: String(returned.id || `return-${index}`),
      originalSaleId: String(returned.originalSaleId || ""),
      orderedAt: String(returned.orderedAt || ""),
      quantity: positiveNumber(returned.quantity),
      index,
    }))
    .filter((returned) => returned.quantity > 0)

  const events = [
    ...sales.map((sale) => ({ ...sale, type: "sale" as const, priority: 0 })),
    ...returns.map((returned) => ({ ...returned, type: "return" as const, priority: 1 })),
  ].sort(
    (left, right) =>
      left.orderedAt.localeCompare(right.orderedAt) || left.priority - right.priority || left.index - right.index,
  )

  const queue: WorkingBatch[] = []
  const openingQty = positiveNumber(input.openingQty)
  if (openingQty > 0) {
    const openingUnitCost = positiveNumber(input.openingUnitCost)
    queue.push({ remainingQty: openingQty, unitCost: openingUnitCost > 0 ? openingUnitCost : null })
  }

  const result = new Map<string, FifoSaleCost>()
  const completedSaleUnitCost = new Map<string, number>()
  const remainingReturnableQty = new Map<string, number>()
  const saleQuantityById = new Map(sales.map((sale) => [sale.id, sale.quantity]))
  const pendingDeficits: Array<{ saleId: string; remainingQty: number; fallbackUnitCost: number | null }> = []
  let lastKnownUnitCost = nonNegativeNumberOrNull(input.openingUnitCost)
  const configuredFallbackUnitCost = nonNegativeNumberOrNull(input.fallbackUnitCost)
  let purchaseIndex = 0
  let batchIndex = 0

  const finalizeSaleCostIfKnown = (saleId: string) => {
    const saleCost = result.get(saleId)
    const saleQuantity = positiveNumber(saleQuantityById.get(saleId))
    if (saleCost && saleCost.unknownQty <= 0 && saleQuantity > 0) {
      completedSaleUnitCost.set(saleId, saleCost.cogs / saleQuantity)
    }
  }

  const applyPurchase = (purchase: (typeof purchases)[number]) => {
    let remainingQty = purchase.quantity
    if (purchase.unitCost !== null) lastKnownUnitCost = purchase.unitCost

    while (remainingQty > 0 && pendingDeficits.length > 0) {
      const deficit = pendingDeficits[0]
      const used = Math.min(remainingQty, deficit.remainingQty)
      const saleCost = result.get(deficit.saleId)

      if (saleCost && purchase.unitCost !== null) {
        saleCost.cogs += used * purchase.unitCost
        saleCost.unknownQty = Math.max(0, saleCost.unknownQty - used)
        deficit.fallbackUnitCost = purchase.unitCost
      }

      deficit.remainingQty -= used
      remainingQty -= used

      if (deficit.remainingQty <= 0) {
        pendingDeficits.shift()
        finalizeSaleCostIfKnown(deficit.saleId)
      }
    }

    if (remainingQty > 0) queue.push({ remainingQty, unitCost: purchase.unitCost })
  }

  for (const event of events) {
    while (purchaseIndex < purchases.length && purchases[purchaseIndex].orderedAt <= event.orderedAt) {
      applyPurchase(purchases[purchaseIndex])
      purchaseIndex += 1
    }

    if (event.type === "return") {
      const returnableQty = positiveNumber(remainingReturnableQty.get(event.originalSaleId))
      const restoredQty = Math.min(event.quantity, returnableQty)
      const hasKnownSaleCost = completedSaleUnitCost.has(event.originalSaleId)
      const saleUnitCost = completedSaleUnitCost.get(event.originalSaleId) ?? 0
      const knownQty = hasKnownSaleCost ? restoredQty : 0
      const unknownQty = event.quantity - knownQty

      if (knownQty > 0) queue.push({ remainingQty: knownQty, unitCost: saleUnitCost })
      if (unknownQty > 0) queue.push({ remainingQty: unknownQty, unitCost: null })

      remainingReturnableQty.set(event.originalSaleId, Math.max(0, returnableQty - restoredQty))
      result.set(event.id, { cogs: knownQty * saleUnitCost, unknownQty, provisionalQty: 0 })
      continue
    }

    let remaining = event.quantity
    let cogs = 0
    let unknownQty = 0

    while (remaining > 0 && batchIndex < queue.length) {
      const batch = queue[batchIndex]
      if (batch.remainingQty <= 0) {
        batchIndex += 1
        continue
      }

      const used = Math.min(remaining, batch.remainingQty)
      // A purchase price of 0 is a valid, confirmed cost for free goods.
      // Only a missing cost is unresolved.
      if (batch.unitCost === null) {
        unknownQty += used
      } else {
        cogs += used * batch.unitCost
      }
      batch.remainingQty -= used
      remaining -= used
    }

    // There was no inventory available on this business date. Keep the cost
    // unresolved instead of treating it as zero or borrowing a future receipt.
    unknownQty += remaining
    result.set(event.id, { cogs, unknownQty, provisionalQty: 0 })
    if (remaining > 0) {
      pendingDeficits.push({
        saleId: event.id,
        remainingQty: remaining,
        fallbackUnitCost: lastKnownUnitCost ?? configuredFallbackUnitCost,
      })
    }
    remainingReturnableQty.set(event.id, event.quantity)
    finalizeSaleCostIfKnown(event.id)
  }

  // Receipts entered after the last sale still settle the oldest negative sale.
  while (purchaseIndex < purchases.length) {
    applyPurchase(purchases[purchaseIndex])
    purchaseIndex += 1
  }

  // Anything still negative is valued provisionally so current gross profit can
  // be shown. A future receipt will replace this estimate on the next full run.
  for (const deficit of pendingDeficits) {
    const saleCost = result.get(deficit.saleId)
    const fallbackUnitCost = deficit.fallbackUnitCost ?? lastKnownUnitCost ?? configuredFallbackUnitCost
    if (!saleCost || fallbackUnitCost === null) continue

    saleCost.cogs += deficit.remainingQty * fallbackUnitCost
    saleCost.unknownQty = Math.max(0, saleCost.unknownQty - deficit.remainingQty)
    saleCost.provisionalQty += deficit.remainingQty
    finalizeSaleCostIfKnown(deficit.saleId)
  }

  return result
}
