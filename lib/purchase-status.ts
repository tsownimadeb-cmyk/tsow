export const CONFIRMED_PURCHASE_STATUS = "completed" as const

/**
 * A saved purchase order represents goods that were actually received.
 * Purchase orders therefore never enter a draft or pending state.
 */
export function purchaseStatusForSave(): typeof CONFIRMED_PURCHASE_STATUS {
  return CONFIRMED_PURCHASE_STATUS
}

export function isCompletedPurchaseStatus(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === CONFIRMED_PURCHASE_STATUS
}
