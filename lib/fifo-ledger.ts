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
}

type WorkingBatch = {
  remainingQty: number
  unitCost: number | null
}

const positiveNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export const resolveFifoPurchaseUnitCost = (calculatedUnitCost: unknown, confirmedOverride: unknown) => {
  const override = positiveNumber(confirmedOverride)
  return override > 0 ? override : positiveNumber(calculatedUnitCost)
}

/**
 * Matches sales to inventory available on the business date.
 * Opening inventory is oldest and can carry a confirmed historical cost. When
 * that cost is missing it remains unresolved. Purchases on the same date are
 * available before sales. Future purchases never repair an earlier sale.
 */
export function calculateFifoSaleCosts(input: {
  openingQty: number
  openingUnitCost?: number | null
  purchases: FifoPurchase[]
  sales: FifoSale[]
  returns?: FifoReturn[]
}): Map<string, FifoSaleCost> {
  const purchases = input.purchases
    .map((purchase) => ({
      orderedAt: String(purchase.orderedAt || ""),
      quantity: positiveNumber(purchase.quantity),
      unitCost: positiveNumber(purchase.unitCost),
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
  let purchaseIndex = 0
  let batchIndex = 0

  for (const event of events) {
    while (purchaseIndex < purchases.length && purchases[purchaseIndex].orderedAt <= event.orderedAt) {
      const purchase = purchases[purchaseIndex]
      queue.push({ remainingQty: purchase.quantity, unitCost: purchase.unitCost })
      purchaseIndex += 1
    }

    if (event.type === "return") {
      const returnableQty = positiveNumber(remainingReturnableQty.get(event.originalSaleId))
      const restoredQty = Math.min(event.quantity, returnableQty)
      const saleUnitCost = completedSaleUnitCost.get(event.originalSaleId) ?? 0
      const knownQty = saleUnitCost > 0 ? restoredQty : 0
      const unknownQty = event.quantity - knownQty

      if (knownQty > 0) queue.push({ remainingQty: knownQty, unitCost: saleUnitCost })
      if (unknownQty > 0) queue.push({ remainingQty: unknownQty, unitCost: null })

      remainingReturnableQty.set(event.originalSaleId, Math.max(0, returnableQty - restoredQty))
      result.set(event.id, { cogs: knownQty * saleUnitCost, unknownQty })
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
      if (batch.unitCost === null || batch.unitCost <= 0) {
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
    result.set(event.id, { cogs, unknownQty })
    remainingReturnableQty.set(event.id, event.quantity)
    if (unknownQty <= 0 && event.quantity > 0) completedSaleUnitCost.set(event.id, cogs / event.quantity)
  }

  return result
}
