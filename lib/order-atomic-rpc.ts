export const SALES_ORDER_ATOMIC_RPC = "save_sales_order_atomic"
export const PURCHASE_ORDER_ATOMIC_RPC = "save_purchase_order_atomic"
export const SALES_ORDER_DELETE_ATOMIC_RPC = "delete_sales_order_atomic"
export const PURCHASE_ORDER_DELETE_ATOMIC_RPC = "delete_purchase_order_atomic"

type RpcErrorLike = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
}

function getRpcErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error || "").toLowerCase()

  const value = error as RpcErrorLike
  return [value.message, value.details, value.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

/**
 * Allows the application and the database migration to be deployed in either
 * order. Only an actually missing function may use the legacy write path;
 * business/validation errors from an installed RPC must never be bypassed.
 */
export function isMissingAtomicOrderRpc(error: unknown, functionName: string): boolean {
  if (!error || typeof error !== "object") return false

  const value = error as RpcErrorLike
  const text = getRpcErrorText(error)

  return (
    value.code === "PGRST202" ||
    value.code === "42883" ||
    (
      text.includes(functionName.toLowerCase()) &&
      (text.includes("could not find the function") || text.includes("does not exist"))
    )
  )
}

/** Supabase can return transport failures as an error object instead of throwing. */
export function isAtomicOrderTransportError(error: unknown): boolean {
  if (!error) return false
  const text = getRpcErrorText(error)

  return (
    text.includes("failed to fetch") ||
    text.includes("fetch failed") ||
    text.includes("network") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("timeout")
  )
}
