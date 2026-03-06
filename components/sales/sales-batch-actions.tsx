"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Download, Settings, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from "@/hooks/use-toast"

type SalesCsvRow = {
  order_no: string
  item_code: string
  quantity: number
  unit_price: number
  sales_date: string
  customer_code: string
}

type SalesExportCsvRow = SalesCsvRow & {
  is_paid: string
}

type ParsedSalesRow = SalesCsvRow & {
  row_no: number
  subtotal: number
  is_paid_input: boolean | null
}

type SalesOrderRow = {
  id: string
  order_no: string
  order_date: string | null
  customer_cno: string | null
  is_paid: boolean | null
  total_amount: number
}

type ImportProgress = {
  stage: string
  processed: number
  total: number
}

const CSV_COLUMNS: Array<keyof SalesCsvRow> = [
  "order_no",
  "item_code",
  "quantity",
  "unit_price",
  "sales_date",
  "customer_code",
]

const EXPORT_CSV_COLUMNS: Array<keyof SalesExportCsvRow> = [...CSV_COLUMNS, "is_paid"]
const IN_FILTER_CHUNK_SIZE = 200
const WRITE_BATCH_SIZE = 500
const MAX_DECIMAL_12_2_ABS = 9999999999.99
const ISO_DATE_TEXT = /^\d{4}-\d{2}-\d{2}$/

const IMPORT_HEADER_ALIAS_MAP: Record<string, keyof SalesExportCsvRow> = {
  order_no: "order_no",
  orderno: "order_no",
  item_code: "item_code",
  code: "item_code",
  quantity: "quantity",
  qty: "quantity",
  unit_price: "unit_price",
  unitprice: "unit_price",
  sales_date: "sales_date",
  sale_date: "sales_date",
  order_date: "sales_date",
  customer_code: "customer_code",
  customer_cno: "customer_code",
  customer_id: "customer_code",
  is_paid: "is_paid",
  ispaid: "is_paid",
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items]
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

function escapeCsvValue(value: string | number | null | undefined) {
  const normalized = value === null || value === undefined ? "" : String(value)
  if (normalized.includes('"') || normalized.includes(",") || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, '""')}"`
  }
  return normalized
}

function parseCsvLine(line: string) {
  const values: string[] = []
  let currentValue = ""
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const currentChar = line[index]
    const nextChar = line[index + 1]

    if (currentChar === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (currentChar === "," && !inQuotes) {
      values.push(currentValue)
      currentValue = ""
      continue
    }

    currentValue += currentChar
  }

  values.push(currentValue)
  return values
}

function sanitizeCsvHeader(header: string) {
  return String(header || "")
    .replace(/^\uFEFF/g, "")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060]/g, "")
    .trim()
}

function sanitizeCsvCellValue(value: string) {
  return String(value || "")
    .replace(/^\uFEFF/g, "")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060]/g, "")
    .trim()
}

function normalizeImportHeader(header: string) {
  const sanitized = sanitizeCsvHeader(header)
  const key = sanitized.toLowerCase().replace(/\s+/g, "_")
  return IMPORT_HEADER_ALIAS_MAP[key] || sanitized
}

function toNumberOrZero(value: string) {
  if (!value?.trim()) return 0
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function toDecimalOrZero(value: string) {
  const normalized = String(value || "").trim().replace(/,/g, "")
  if (!normalized) return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function toIntegerOrRound(value: string, rowNo: number, fieldLabel: string) {
  const normalized = String(value || "").trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) {
    throw new Error(`第 ${rowNo} 列 ${fieldLabel} 不是有效數字：${normalized}`)
  }
  return Number.isInteger(parsed) ? parsed : Math.round(parsed)
}

function parseBooleanInput(value: string) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return null
  if (["true", "1", "yes", "y"].includes(normalized)) return true
  if (["false", "0", "no", "n"].includes(normalized)) return false
  return null
}

function normalizeDateInput(value: string) {
  const raw = String(value || "").trim()
  if (!raw) return ""

  const normalized = raw.replace(/[.]/g, "-").replace(/[\/]/g, "-")
  const parts = normalized
    .split("-")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length !== 3) return raw

  const [year, month, day] = parts
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) {
    return raw
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

function normalizeCode(value: string) {
  return String(value || "").trim().toUpperCase()
}

function assertDecimal12_2(value: number, rowNo: number, fieldLabel: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`第 ${rowNo} 列 ${fieldLabel} 不是有效數值`)
  }
  if (Math.abs(value) > MAX_DECIMAL_12_2_ABS) {
    throw new Error(`第 ${rowNo} 列 ${fieldLabel} 超過資料庫上限（最大 ${MAX_DECIMAL_12_2_ABS}）`)
  }
}

function formatSupabaseError(error: any, fallbackMessage: string) {
  const message = String(error?.message || fallbackMessage)
  const details = String(error?.details || "").trim()
  return details ? `${message}（${details}）` : message
}

function formatRuntimeError(error: unknown, fallbackMessage: string) {
  let message = String((error as any)?.message || "").replace(/^Error:\s*/i, "").trim()
  const marker = "Check network/VPN/firewall and your environment variables."
  if (message.includes(marker)) {
    message = message.slice(0, message.indexOf(marker) + marker.length)
  }
  message = message.split("\n")[0].trim()
  if (!message) return fallbackMessage
  if (/failed to fetch/i.test(message)) {
    return "無法連線到資料庫服務，請檢查網路、VPN 或防火牆後重試"
  }
  if (/unable to reach supabase/i.test(message)) {
    const endpoint = message.match(/\((https?:\/\/[^)]+)\)/)?.[1]
    return endpoint ? `無法連線到資料庫服務：${endpoint}` : "無法連線到資料庫服務，請稍後再試"
  }
  return message
}

function createUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === "x" ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

async function querySalesOrders(supabase: ReturnType<typeof createClient>) {
  const pageSize = 1000
  const allRows: any[] = []

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const result = await supabase
      .from("sales_orders")
      .select("id,order_no,order_date,customer_cno,is_paid,total_amount")
      .order("id", { ascending: true })
      .range(from, to)

    if (result.error) {
      throw new Error("讀取銷貨單資料失敗")
    }

    const batch = result.data || []
    allRows.push(...batch)

    if (batch.length < pageSize) break
  }

  const rows = allRows.map((row: any) => ({
    id: String(row.id ?? ""),
    order_no: String(row.order_no ?? "").trim(),
    order_date: row.order_date ?? null,
    customer_cno: row.customer_cno ?? null,
    is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
    total_amount: Number(row.total_amount ?? 0),
  }))
  return rows as SalesOrderRow[]
}

async function queryCodesWithPaging(
  supabase: ReturnType<typeof createClient>,
  table: string,
  primaryColumn: string,
  fallbackColumn: string | null,
  errorMessage: string,
) {
  const pageSize = 1000
  const codes = new Set<string>()
  const attempts = fallbackColumn
    ? [
        { selectText: `${primaryColumn},${fallbackColumn}`, orderColumn: primaryColumn },
        { selectText: primaryColumn, orderColumn: primaryColumn },
        { selectText: fallbackColumn, orderColumn: fallbackColumn },
      ]
    : [{ selectText: primaryColumn, orderColumn: primaryColumn }]

  for (const attempt of attempts) {
    let hasQueryError = false
    codes.clear()

    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1
      const result = await supabase
        .from(table)
        .select(attempt.selectText)
        .order(attempt.orderColumn, { ascending: true })
        .range(from, to)

      if (result.error) {
        hasQueryError = true
        break
      }

      const batch = result.data || []
      for (const row of batch as any[]) {
        const primaryCode = normalizeCode(String(row?.[primaryColumn] ?? ""))
        const fallbackCode = fallbackColumn ? normalizeCode(String(row?.[fallbackColumn] ?? "")) : ""
        const nextCode = primaryCode || fallbackCode
        if (nextCode) codes.add(nextCode)
      }

      if (batch.length < pageSize) break
    }

    if (!hasQueryError) {
      return codes
    }
  }

  throw new Error(errorMessage)
}

async function queryProductsCodes(supabase: ReturnType<typeof createClient>) {
  return queryCodesWithPaging(supabase, "products", "code", "pno", "讀取商品資料失敗")
}

async function queryCustomerCodes(supabase: ReturnType<typeof createClient>) {
  return queryCodesWithPaging(supabase, "customers", "code", "cno", "讀取客戶資料失敗")
}

async function createSalesOrderByOrderNo(
  supabase: ReturnType<typeof createClient>,
  orderNo: string,
  orderDate: string,
  customerCode: string | null,
) {
  const normalizedOrderNo = String(orderNo || "").trim()
  if (!normalizedOrderNo) {
    throw new Error("建立銷貨單失敗：order_no 不可為空")
  }

  const payloadBase = {
    order_date: orderDate || null,
    customer_cno: customerCode,
    total_amount: 0,
    status: "completed",
    is_paid: false,
  }

  const { error } = await supabase.from("sales_orders").insert({ ...payloadBase, order_no: normalizedOrderNo })
  if (!error) {
    return
  }
  if (String(error?.code || "") === "23505") {
    return
  }

  throw new Error(formatSupabaseError(error, `建立銷貨單 ${normalizedOrderNo} 失敗`))
}

async function queryExistingItemIdsByOrderAndCode(
  supabase: ReturnType<typeof createClient>,
  ordersById: Map<string, SalesOrderRow>,
  targetOrderIds?: string[],
) {
  const rows: any[] = []

  if (targetOrderIds && targetOrderIds.length > 0) {
    for (const orderIdChunk of chunkArray(targetOrderIds, IN_FILTER_CHUNK_SIZE)) {
      const result = await supabase
        .from("sales_order_items")
        .select("id,sales_order_id,code")
        .in("sales_order_id", orderIdChunk)

      if (result.error) {
        throw new Error(formatSupabaseError(result.error, "讀取銷貨明細失敗"))
      }

      rows.push(...((result.data || []) as any[]))
    }
  } else {
    const result = await supabase.from("sales_order_items").select("id,sales_order_id,code")
    if (result.error) {
      throw new Error(formatSupabaseError(result.error, "讀取銷貨明細失敗"))
    }
    rows.push(...((result.data || []) as any[]))
  }

  const keyToId = new Map<string, string>()
  for (const row of rows) {
    const orderNo = String(ordersById.get(String(row.sales_order_id ?? ""))?.order_no ?? "").trim()
    const itemCode = String(row.code ?? "").trim()
    const id = String(row.id ?? "").trim()
    if (!orderNo || !itemCode || !id) continue
    keyToId.set(`${orderNo}::${itemCode}`, id)
  }

  return keyToId
}

async function upsertSalesItems(
  supabase: ReturnType<typeof createClient>,
  rows: Array<{ id: string; sales_order_id: string; code: string; quantity: number; unit_price: number; subtotal: number }>,
  onProgress?: (processed: number, total: number) => void,
) {
  const payload = rows.map((row) => ({
    id: row.id,
    sales_order_id: row.sales_order_id,
    code: row.code,
    quantity: row.quantity,
    unit_price: row.unit_price,
    subtotal: row.subtotal,
  }))

  let processed = 0
  const total = payload.length
  for (const payloadChunk of chunkArray(payload, WRITE_BATCH_SIZE)) {
    const { error } = await supabase
      .from("sales_order_items")
      .upsert(payloadChunk, { onConflict: "id", on_conflict: "id" } as any)

    if (error) {
      throw new Error(formatSupabaseError(error, "匯入銷貨明細失敗"))
    }

    processed += payloadChunk.length
    onProgress?.(processed, total)
  }
}

async function recalculateProductStocksFromTransactions(
  supabase: ReturnType<typeof createClient>,
  targetCodes: string[],
  onProgress?: (processed: number, total: number) => void,
) {
  const normalizedCodes = Array.from(
    new Set((targetCodes || []).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)),
  )
  if (normalizedCodes.length === 0) {
    return
  }

  const codeChunks = chunkArray(normalizedCodes, IN_FILTER_CHUNK_SIZE)
  const totalSteps = codeChunks.length * 3
  let processedSteps = 0

  const purchaseTotals = new Map<string, number>()
  const salesTotals = new Map<string, number>()

  for (const codeChunk of codeChunks) {
    const purchaseResult = await supabase
      .from("purchase_order_items")
      .select("code,quantity")
      .in("code", codeChunk)
    if (purchaseResult.error) {
      throw new Error(formatSupabaseError(purchaseResult.error, "重算庫存失敗：讀取進貨明細失敗"))
    }

    for (const row of (purchaseResult.data || []) as any[]) {
      const code = String(row.code || "").trim().toUpperCase()
      if (!code) continue
      const quantity = Number(row.quantity || 0)
      purchaseTotals.set(code, Number(purchaseTotals.get(code) || 0) + (Number.isFinite(quantity) ? quantity : 0))
    }
    processedSteps += 1
    onProgress?.(processedSteps, totalSteps)

    const salesResult = await supabase
      .from("sales_order_items")
      .select("code,quantity")
      .in("code", codeChunk)
    if (salesResult.error) {
      throw new Error(formatSupabaseError(salesResult.error, "重算庫存失敗：讀取銷貨明細失敗"))
    }

    for (const row of (salesResult.data || []) as any[]) {
      const code = String(row.code || "").trim().toUpperCase()
      if (!code) continue
      const quantity = Number(row.quantity || 0)
      salesTotals.set(code, Number(salesTotals.get(code) || 0) + (Number.isFinite(quantity) ? quantity : 0))
    }
    processedSteps += 1
    onProgress?.(processedSteps, totalSteps)
  }

  for (const codeChunk of codeChunks) {
    const payloadChunk = codeChunk.map((code) => {
      const purchaseQty = Number(purchaseTotals.get(code) || 0)
      const salesQty = Number(salesTotals.get(code) || 0)
      const nextStockQty = Math.max(0, purchaseQty - salesQty)
      return { code, stock_qty: nextStockQty }
    })

    const { error: upsertError } = await supabase
      .from("products")
      .upsert(payloadChunk, { onConflict: "code", on_conflict: "code" } as any)

    if (upsertError) {
      // Fallback for environments where upsert constraints differ.
      await Promise.all(
        payloadChunk.map(async (row) => {
          const { error: updateError } = await supabase
            .from("products")
            .update({ stock_qty: row.stock_qty })
            .ilike("code", row.code)

          if (updateError) {
            throw new Error(formatSupabaseError(updateError, `重算庫存失敗：更新商品 ${row.code} 失敗`))
          }
        }),
      )
    }

    processedSteps += 1
    onProgress?.(processedSteps, totalSteps)
  }
}

async function syncAccountsReceivable(
  supabase: ReturnType<typeof createClient>,
  targetOrderIds: string[],
  onProgress?: (processed: number, total: number) => void,
) {
  const normalizedOrderIds = Array.from(new Set((targetOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  if (normalizedOrderIds.length === 0) {
    return
  }

  const orderIdChunks = chunkArray(normalizedOrderIds, IN_FILTER_CHUNK_SIZE)
  let processedSteps = 0
  let totalSteps = orderIdChunks.length * 3
  onProgress?.(processedSteps, totalSteps)

  const orderRows: any[] = []
  for (const orderIdChunk of orderIdChunks) {
    const result = await supabase
      .from("sales_orders")
      .select("id,order_no,order_date,customer_cno,is_paid,total_amount")
      .in("id", orderIdChunk)

    if (result.error) {
      throw new Error(formatSupabaseError(result.error, "讀取目標銷貨單失敗"))
    }

    orderRows.push(...(result.data || []))
    processedSteps += 1
    onProgress?.(processedSteps, totalSteps)
  }

  const orders = orderRows.map((row: any) => ({
    id: String(row.id ?? ""),
    order_no: String(row.order_no ?? "").trim(),
    order_date: row.order_date ?? null,
    customer_cno: row.customer_cno ?? null,
    is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
    total_amount: Number(row.total_amount ?? 0),
  })) as SalesOrderRow[]

  // Keep progress shape stable while skipping the old expensive scans.
  processedSteps += orderIdChunks.length * 2
  onProgress?.(processedSteps, totalSteps)

  const upsertRows: Array<{
    sales_order_id: string
    customer_cno: string | null
    amount_due: number
    total_amount: number
    paid_amount: number
    overpaid_amount: number
    due_date: string | null
    status: string
  }> = []

  for (const order of orders) {
    if (!order.id) continue
    const rawTotalAmount = Number(order.total_amount || 0)
    const totalAmount = Number.isFinite(rawTotalAmount) ? Math.max(0, rawTotalAmount) : 0
    const paid = Boolean(order.is_paid)
    const paidAmount = paid ? totalAmount : 0

    const payload = {
      customer_cno: order.customer_cno,
      amount_due: totalAmount,
      total_amount: totalAmount,
      paid_amount: Math.min(totalAmount, Math.max(0, paidAmount)),
      overpaid_amount: 0,
      due_date: normalizeDateInput(String(order.order_date || "")) || null,
      status: paid ? "paid" : "unpaid",
    }

    upsertRows.push({
      sales_order_id: order.id,
      ...payload,
    })
  }

  const upsertChunks = chunkArray(upsertRows, WRITE_BATCH_SIZE)
  totalSteps += upsertChunks.length
  onProgress?.(processedSteps, totalSteps)

  for (const payloadChunk of upsertChunks) {
    const { error: upsertError } = await supabase
      .from("accounts_receivable")
      .upsert(payloadChunk, { onConflict: "sales_order_id", on_conflict: "sales_order_id" } as any)

    if (!upsertError) {
      processedSteps += 1
      onProgress?.(processedSteps, totalSteps)
      continue
    }

    const chunkOrderIds = payloadChunk
      .map((row) => String(row.sales_order_id || "").trim())
      .filter(Boolean)
    const arBySalesOrderId = new Map<string, string>()

    if (chunkOrderIds.length > 0) {
      const { data: existingRows, error: existingError } = await supabase
        .from("accounts_receivable")
        .select("id,sales_order_id")
        .in("sales_order_id", chunkOrderIds)

      if (existingError) {
        throw new Error(formatSupabaseError(existingError, "同步應收帳款失敗"))
      }

      for (const existingRow of (existingRows || []) as any[]) {
        const salesOrderId = String(existingRow.sales_order_id ?? "").trim()
        const arId = String(existingRow.id ?? "").trim()
        if (!salesOrderId || !arId) continue
        arBySalesOrderId.set(salesOrderId, arId)
      }
    }

    for (const row of payloadChunk) {
      const existingId = arBySalesOrderId.get(String(row.sales_order_id || "").trim())
      if (existingId) {
        const { error: updateError } = await supabase
          .from("accounts_receivable")
          .update({
            customer_cno: row.customer_cno,
            amount_due: row.amount_due,
            total_amount: row.total_amount,
            paid_amount: row.paid_amount,
            overpaid_amount: row.overpaid_amount,
            due_date: row.due_date,
            status: row.status,
          })
          .eq("id", existingId)
        if (updateError) {
          throw new Error(formatSupabaseError(updateError, "更新應收帳款失敗"))
        }
      } else {
        const { error: insertError } = await supabase.from("accounts_receivable").insert(row)
        if (insertError) {
          throw new Error(formatSupabaseError(insertError, "建立應收帳款失敗"))
        }
      }
    }

    processedSteps += 1
    onProgress?.(processedSteps, totalSteps)
  }
}

export function SalesBatchActions() {
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [syncDeleteMissing, setSyncDeleteMissing] = useState(false)

  const importProgressText = (() => {
    if (!isImporting) return "匯入批次修改"
    if (!importProgress) return "匯入中..."
    const safeTotal = Math.max(1, importProgress.total)
    const safeProcessed = Math.min(importProgress.processed, safeTotal)
    const percent = Math.min(100, Math.round((safeProcessed / safeTotal) * 100))
    return `匯入中 ${importProgress.stage} ${safeProcessed}/${safeTotal}（${percent}%）`
  })()

  const toastApi = {
    success: (message: string) =>
      toast({
        title: "成功",
        description: message,
      }),
    error: (message: string) =>
      toast({
        title: "錯誤",
        description: message,
        variant: "destructive",
      }),
  }

  const handleExportCsv = async () => {
    try {
      setIsExporting(true)
      const supabase = createClient()
      const orders = await querySalesOrders(supabase)
      const orderById = new Map(orders.map((order) => [order.id, order]))

      const pageSize = 1000
      const itemRows: any[] = []

      for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1
        const result = await supabase
          .from("sales_order_items")
          .select("id,sales_order_id,code,quantity,unit_price")
          .order("id", { ascending: true })
          .range(from, to)

        if (result.error) {
          throw new Error("讀取銷貨明細失敗")
        }

        const batch = (result.data || []) as any[]
        itemRows.push(...batch)

        if (batch.length < pageSize) {
          break
        }
      }

      const exportRows: SalesExportCsvRow[] = itemRows.map((item) => {
        const order = orderById.get(String(item.sales_order_id ?? ""))
        return {
          order_no: String(order?.order_no ?? "").trim(),
          item_code: String(item.code ?? "").trim(),
          quantity: Number(item.quantity ?? 0),
          unit_price: Number(item.unit_price ?? 0),
          sales_date: String(order?.order_date ?? ""),
          customer_code: String(order?.customer_cno ?? ""),
          is_paid: order?.is_paid === true ? "true" : "false",
        }
      }).sort((a, b) => {
        const timeA = a.sales_date ? Date.parse(String(a.sales_date)) : Number.NaN
        const timeB = b.sales_date ? Date.parse(String(b.sales_date)) : Number.NaN
        const safeA = Number.isFinite(timeA) ? timeA : -Infinity
        const safeB = Number.isFinite(timeB) ? timeB : -Infinity
        if (safeA !== safeB) return safeB - safeA

        const orderCompare = String(a.order_no || "").localeCompare(String(b.order_no || ""), "en", { numeric: true })
        if (orderCompare !== 0) return orderCompare
        return String(a.item_code || "").localeCompare(String(b.item_code || ""), "en", { numeric: true })
      })

      const header = EXPORT_CSV_COLUMNS.join(",")
      const rows = exportRows.map((row) => EXPORT_CSV_COLUMNS.map((column) => escapeCsvValue(row[column])).join(","))
      const csvContent = `\uFEFF${[header, ...rows].join("\n")}`

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `sales_items_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toastApi.error(formatRuntimeError(error, "匯出銷貨明細 CSV 失敗"))
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    const isConfirmed = window.confirm("這將根據單號與商品編號覆蓋現有資料，確定執行嗎？")
    if (!isConfirmed) return

    try {
      setIsImporting(true)
      setImportProgress({ stage: "讀取檔案", processed: 0, total: 1 })

      const rawText = await file.text()
      const text = rawText.replace(/^\uFEFF/, "")
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      const csvLines = lines[0]?.toLowerCase() === "sep=," ? lines.slice(1) : lines

      if (csvLines.length < 2) {
        throw new Error("CSV 內容不足，至少需要標題列與一筆資料")
      }

      const parsedHeaders = parseCsvLine(csvLines[0]).map((header) => normalizeImportHeader(header))
      const headers = [...parsedHeaders]
      for (const requiredColumn of CSV_COLUMNS) {
        if (!headers.includes(requiredColumn)) {
          throw new Error(`CSV 缺少必要欄位：${requiredColumn}`)
        }
      }

      const parsedRows: ParsedSalesRow[] = []
      let roundedQuantityCount = 0
      const parseTotal = Math.max(csvLines.length - 1, 1)
      csvLines.slice(1).forEach((line, index) => {
        if (index % 200 === 0 || index + 1 === parseTotal) {
          setImportProgress({ stage: "解析 CSV", processed: index + 1, total: parseTotal })
        }
        const values = parseCsvLine(line)
        if (values.length > headers.length) {
          throw new Error(`第 ${index + 2} 列欄位數量異常，可能有數字千分位逗號未加雙引號`)
        }
        const valueByColumn = headers.reduce<Record<string, string>>((accumulator, header, columnIndex) => {
          accumulator[header] = values[columnIndex] ?? ""
          return accumulator
        }, {})

        const orderNo = sanitizeCsvCellValue(String(valueByColumn.order_no ?? ""))
        const itemCode = sanitizeCsvCellValue(String(valueByColumn.item_code ?? ""))
        const salesDate = sanitizeCsvCellValue(String(valueByColumn.sales_date ?? ""))
        const customerCode = sanitizeCsvCellValue(String(valueByColumn.customer_code ?? ""))
        const quantityText = sanitizeCsvCellValue(String(valueByColumn.quantity ?? ""))
        const unitPriceText = sanitizeCsvCellValue(String(valueByColumn.unit_price ?? ""))
        const isPaidText = sanitizeCsvCellValue(String(valueByColumn.is_paid ?? ""))

        const isCompletelyEmpty = !orderNo && !itemCode && !salesDate && !customerCode && !quantityText && !unitPriceText
        if (isCompletelyEmpty) return

        if (!orderNo) {
          throw new Error(`第 ${index + 2} 列缺少 order_no，請填入你要的新單號`)
        }

        const quantityRaw = toNumberOrZero(quantityText)
        const quantity = toIntegerOrRound(quantityText, index + 2, "quantity")
        if (Number.isFinite(quantityRaw) && !Number.isInteger(quantityRaw)) {
          roundedQuantityCount += 1
        }
        const unitPrice = toDecimalOrZero(unitPriceText)
        const normalizedSalesDate = normalizeDateInput(salesDate)
        if (salesDate && !ISO_DATE_TEXT.test(normalizedSalesDate)) {
          throw new Error(`第 ${index + 2} 列 sales_date 不是有效日期：${salesDate}`)
        }

        const subtotal = Number((quantity * unitPrice).toFixed(2))
        assertDecimal12_2(unitPrice, index + 2, "unit_price")
        assertDecimal12_2(subtotal, index + 2, "subtotal")
        const isPaidInput = parseBooleanInput(isPaidText)

        parsedRows.push({
          row_no: index + 2,
          order_no: orderNo,
          item_code: itemCode,
          quantity,
          unit_price: unitPrice,
          sales_date: normalizedSalesDate || salesDate,
          customer_code: customerCode,
          subtotal,
          is_paid_input: isPaidInput,
        })
      })

      if (parsedRows.length === 0) {
        throw new Error("沒有可匯入的資料，請確認 item_code 欄位")
      }

      const totalRows = parsedRows.length
      setImportProgress({ stage: "驗證資料", processed: 0, total: totalRows })

      const affectedCodes = new Set(
        parsedRows
          .map((row) => String(row.item_code || "").trim().toUpperCase())
          .filter(Boolean),
      )

      if (syncDeleteMissing) {
        const secondConfirm = window.confirm(
          "已啟用同步刪除：系統將刪除所有不在 CSV 內的銷貨明細（order_no + item_code）。此操作無法復原，確定繼續嗎？",
        )
        if (!secondConfirm) return
      }

      const supabase = createClient()
      const [initialOrders, productCodes, customerCodes] = await Promise.all([
        querySalesOrders(supabase),
        queryProductsCodes(supabase),
        queryCustomerCodes(supabase),
      ])

      const orderByNo = new Map(initialOrders.map((order) => [order.order_no, order]))
      const missingOrderNos = new Set<string>()

      for (let rowIndex = 0; rowIndex < parsedRows.length; rowIndex += 1) {
        const row = parsedRows[rowIndex]
        if (rowIndex % 200 === 0 || rowIndex + 1 === parsedRows.length) {
          setImportProgress({ stage: "驗證資料", processed: rowIndex + 1, total: totalRows })
        }
        const normalizedItemCode = normalizeCode(row.item_code)
        const normalizedCustomerCode = normalizeCode(row.customer_code)

        if (!normalizedItemCode || !productCodes.has(normalizedItemCode)) {
          throw new Error(`第 ${row.row_no} 列失敗：item_code ${row.item_code || "(空白)"} 不存在`)
        }

        if (normalizedCustomerCode && !customerCodes.has(normalizedCustomerCode)) {
          throw new Error(`第 ${row.row_no} 列失敗：customer_code ${row.customer_code} 不存在`)
        }

        if (!orderByNo.has(row.order_no)) {
          missingOrderNos.add(row.order_no)
        }
      }

      const missingOrderPayload = Array.from(missingOrderNos)
        .map((missingOrderNo) => {
          const sampleRow = parsedRows.find((row) => row.order_no === missingOrderNo)
          if (!sampleRow) return null

          return {
            order_no: missingOrderNo,
            order_date: normalizeDateInput(sampleRow.sales_date) || null,
            customer_cno: String(sampleRow.customer_code || "").trim() || null,
            total_amount: 0,
            status: "completed",
            is_paid: false,
          }
        })
        .filter((row): row is {
          order_no: string
          order_date: string | null
          customer_cno: string | null
          total_amount: number
          status: string
          is_paid: boolean
        } => Boolean(row))

      if (missingOrderPayload.length > 0) {
        for (const payloadChunk of chunkArray(missingOrderPayload, WRITE_BATCH_SIZE)) {
          const { error: createMissingOrdersError } = await supabase
            .from("sales_orders")
            .upsert(payloadChunk, { onConflict: "order_no", on_conflict: "order_no" } as any)

          if (createMissingOrdersError) {
            throw new Error(formatSupabaseError(createMissingOrdersError, "建立缺少銷貨單失敗"))
          }
        }
      }

      let orders = await querySalesOrders(supabase)
      let latestOrderByNo = new Map(orders.map((order) => [order.order_no, order]))
      let orderById = new Map(orders.map((order) => [order.id, order]))
      const targetOrderIds = Array.from(
        new Set(
          parsedRows
            .map((row) => String(latestOrderByNo.get(row.order_no)?.id || "").trim())
            .filter(Boolean),
        ),
      )
      const headerUpdates = new Map<string, { order_date: string; customer_cno: string | null; total_amount: number; is_paid: boolean }>()

      for (const row of parsedRows) {
        let order = latestOrderByNo.get(row.order_no)
        if (!order) {
          await createSalesOrderByOrderNo(
            supabase,
            row.order_no,
            normalizeDateInput(row.sales_date),
            String(row.customer_code || "").trim() || null,
          )
          orders = await querySalesOrders(supabase)
          latestOrderByNo = new Map(orders.map((nextOrder) => [nextOrder.order_no, nextOrder]))
          orderById = new Map(orders.map((nextOrder) => [nextOrder.id, nextOrder]))
          order = latestOrderByNo.get(row.order_no)
        }
        if (!order) {
          throw new Error(`第 ${row.row_no} 列失敗：order_no ${row.order_no} 不存在`)
        }

        const current = headerUpdates.get(row.order_no)
        const mergedOrderDate =
          normalizeDateInput(row.sales_date) || current?.order_date || normalizeDateInput(String(order.order_date || "")) || ""
        const mergedCustomerCode =
          String(row.customer_code || "").trim() || current?.customer_cno || (String(order.customer_cno || "").trim() || null)
        const mergedTotal = Number(current?.total_amount || 0) + Number(row.subtotal)
        assertDecimal12_2(mergedTotal, row.row_no, "total_amount")
        const mergedIsPaid =
          row.is_paid_input === null || row.is_paid_input === undefined
            ? (current?.is_paid ?? Boolean(order.is_paid))
            : row.is_paid_input

        headerUpdates.set(row.order_no, {
          order_date: mergedOrderDate,
          customer_cno: mergedCustomerCode,
          total_amount: mergedTotal,
          is_paid: mergedIsPaid,
        })
      }

      const headerUpdatePayload = Array.from(headerUpdates.entries()).map(([orderNo, header]) => ({
        order_no: orderNo,
        order_date: header.order_date || null,
        customer_cno: header.customer_cno,
        total_amount: Number(header.total_amount || 0),
        is_paid: header.is_paid,
      }))

      if (headerUpdatePayload.length > 0) {
        setImportProgress({ stage: "更新單頭", processed: 0, total: headerUpdatePayload.length })
        let updatedHeaders = 0
        for (const payloadChunk of chunkArray(headerUpdatePayload, WRITE_BATCH_SIZE)) {
          const { error: updateError } = await supabase
            .from("sales_orders")
            .upsert(payloadChunk, { onConflict: "order_no", on_conflict: "order_no" } as any)

          if (updateError) {
            throw new Error(formatSupabaseError(updateError, "批次更新銷貨單單頭失敗"))
          }

          updatedHeaders += payloadChunk.length
          setImportProgress({ stage: "更新單頭", processed: updatedHeaders, total: headerUpdatePayload.length })
        }
      }

      if (targetOrderIds.length > 0) {
        const cleanupChunks = chunkArray(targetOrderIds, IN_FILTER_CHUNK_SIZE)
        let cleanupProcessed = 0
        setImportProgress({ stage: "清除舊資料", processed: 0, total: cleanupChunks.length })

        for (const orderIdChunk of cleanupChunks) {
          const result = await supabase
            .from("sales_order_items")
            .delete()
            .in("sales_order_id", orderIdChunk)
          if (result.error) {
            throw new Error(formatSupabaseError(result.error, "清除既有銷貨明細失敗"))
          }

          cleanupProcessed += 1
          setImportProgress({ stage: "清除舊資料", processed: cleanupProcessed, total: cleanupChunks.length })
        }
      }

      const upsertPayloadByKey = new Map<
        string,
        {
          id: string
          sales_order_id: string
          code: string
          quantity: number
          unit_price: number
          subtotal: number
        }
      >()

      for (const row of parsedRows) {
        let order = latestOrderByNo.get(row.order_no)
        if (!order) {
          await createSalesOrderByOrderNo(
            supabase,
            row.order_no,
            normalizeDateInput(row.sales_date),
            String(row.customer_code || "").trim() || null,
          )
          orders = await querySalesOrders(supabase)
          latestOrderByNo = new Map(orders.map((nextOrder) => [nextOrder.order_no, nextOrder]))
          orderById = new Map(orders.map((nextOrder) => [nextOrder.id, nextOrder]))
          order = latestOrderByNo.get(row.order_no)
        }
        if (!order) {
          throw new Error(`第 ${row.row_no} 列失敗：order_no ${row.order_no} 不存在`)
        }

        const payload = {
          id: createUuid(),
          sales_order_id: order.id,
          code: row.item_code,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          subtotal: Number(row.subtotal),
        }

        const dedupeKey = `${order.id}::${row.item_code}`
        upsertPayloadByKey.set(dedupeKey, payload)
      }

      const upsertPayload = Array.from(upsertPayloadByKey.values())
      setImportProgress({ stage: "寫入明細", processed: 0, total: upsertPayload.length })
      await upsertSalesItems(supabase, upsertPayload, (processed, total) => {
        setImportProgress({ stage: "寫入明細", processed, total })
      })

      const affectedOrderIds = new Set<string>(targetOrderIds)
      for (const row of upsertPayload) {
        const insertedOrderId = String(row.sales_order_id || "").trim()
        if (insertedOrderId) {
          affectedOrderIds.add(insertedOrderId)
        }
      }

      if (syncDeleteMissing) {
        const csvItemKeys = new Set(parsedRows.map((row) => `${row.order_no}::${row.item_code}`))
        const csvOrderNos = new Set(parsedRows.map((row) => String(row.order_no || "").trim()).filter(Boolean))
        const existingRows = await queryExistingItemIdsByOrderAndCode(supabase, orderById)
        const idsToDelete: string[] = []

        for (const [itemKey, itemId] of existingRows.entries()) {
          if (!csvItemKeys.has(itemKey)) {
            idsToDelete.push(itemId)
            const deletedOrderNo = String(itemKey.split("::")[0] || "").trim()
            const deletedCode = String(itemKey.split("::")[1] || "").trim().toUpperCase()
            const deletedOrder = latestOrderByNo.get(deletedOrderNo)
            if (deletedOrder?.id) {
              affectedOrderIds.add(String(deletedOrder.id))
            }
            if (deletedCode) {
              affectedCodes.add(deletedCode)
            }
          }
        }

        const orderIdsToDelete: string[] = []
        const orderNosToDelete: string[] = []
        for (const order of orders) {
          const existingOrderNo = String(order.order_no || "").trim()
          if (!existingOrderNo) continue
          if (csvOrderNos.has(existingOrderNo)) continue
          if (order.id) orderIdsToDelete.push(String(order.id))
          orderNosToDelete.push(existingOrderNo)
        }

        const cleanupTotal =
          chunkArray(idsToDelete, IN_FILTER_CHUNK_SIZE).length +
          chunkArray(orderIdsToDelete, IN_FILTER_CHUNK_SIZE).length * 3 +
          chunkArray(orderNosToDelete, IN_FILTER_CHUNK_SIZE).length
        let cleanupProcessed = 0
        if (cleanupTotal > 0) {
          setImportProgress({ stage: "清除舊資料", processed: 0, total: cleanupTotal })
        }

        if (idsToDelete.length > 0) {
          for (const idChunk of chunkArray(idsToDelete, IN_FILTER_CHUNK_SIZE)) {
            const { error: deleteError } = await supabase.from("sales_order_items").delete().in("id", idChunk)
            if (deleteError) {
              throw new Error(formatSupabaseError(deleteError, "刪除缺少銷貨明細失敗"))
            }

            cleanupProcessed += 1
            if (cleanupTotal > 0) {
              setImportProgress({ stage: "清除舊資料", processed: cleanupProcessed, total: cleanupTotal })
            }
          }
        }

        if (orderIdsToDelete.length > 0) {
          for (const orderIdChunk of chunkArray(orderIdsToDelete, IN_FILTER_CHUNK_SIZE)) {
            const { error: deleteItemsByOrderIdError } = await supabase
              .from("sales_order_items")
              .delete()
              .in("sales_order_id", orderIdChunk)
            if (deleteItemsByOrderIdError) {
              throw new Error(formatSupabaseError(deleteItemsByOrderIdError, "刪除缺少銷貨單明細失敗"))
            }

            cleanupProcessed += 1
            if (cleanupTotal > 0) {
              setImportProgress({ stage: "清除舊資料", processed: cleanupProcessed, total: cleanupTotal })
            }
          }

          for (const orderIdChunk of chunkArray(orderIdsToDelete, IN_FILTER_CHUNK_SIZE)) {
            const { error: deleteArError } = await supabase
              .from("accounts_receivable")
              .delete()
              .in("sales_order_id", orderIdChunk)
            if (deleteArError) {
              throw new Error(formatSupabaseError(deleteArError, "刪除缺少應收帳款失敗"))
            }

            cleanupProcessed += 1
            if (cleanupTotal > 0) {
              setImportProgress({ stage: "清除舊資料", processed: cleanupProcessed, total: cleanupTotal })
            }
          }

          for (const orderIdChunk of chunkArray(orderIdsToDelete, IN_FILTER_CHUNK_SIZE)) {
            const { error: deleteOrdersError } = await supabase
              .from("sales_orders")
              .delete()
              .in("id", orderIdChunk)
            if (deleteOrdersError) {
              throw new Error(formatSupabaseError(deleteOrdersError, "刪除缺少銷貨單失敗"))
            }

            cleanupProcessed += 1
            if (cleanupTotal > 0) {
              setImportProgress({ stage: "清除舊資料", processed: cleanupProcessed, total: cleanupTotal })
            }
          }
        }

        if (orderNosToDelete.length > 0) {
          for (const orderNoChunk of chunkArray(orderNosToDelete, IN_FILTER_CHUNK_SIZE)) {
            await supabase.from("sales_orders").delete().in("order_no", orderNoChunk)

            cleanupProcessed += 1
            if (cleanupTotal > 0) {
              setImportProgress({ stage: "清除舊資料", processed: cleanupProcessed, total: cleanupTotal })
            }
          }
        }
      }

      setImportProgress({ stage: "重算庫存", processed: 0, total: 1 })
      await recalculateProductStocksFromTransactions(supabase, Array.from(affectedCodes), (processed, total) => {
        setImportProgress({ stage: "重算庫存", processed, total })
      })

      setImportProgress({ stage: "同步應收", processed: 0, total: 1 })
      await syncAccountsReceivable(supabase, Array.from(affectedOrderIds), (processed, total) => {
        setImportProgress({ stage: "同步應收", processed, total })
      })

      const roundedHint = roundedQuantityCount > 0 ? `（quantity 小數已自動四捨五入 ${roundedQuantityCount} 筆）` : ""
      toastApi.success(`銷貨資料批次更新完成${roundedHint}`)
      router.refresh()
    } catch (error: any) {
      toastApi.error(formatRuntimeError(error, "匯入失敗"))
    } finally {
      setIsImporting(false)
      setImportProgress(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={isExporting || isImporting}
            aria-label="銷貨單操作"
            title="銷貨單操作"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>批次操作</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleExportCsv} disabled={isExporting || isImporting}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "匯出中..." : "匯出銷貨明細 CSV"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleImportClick} disabled={isExporting || isImporting}>
            <Upload className="mr-2 h-4 w-4" />
            {importProgressText}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={syncDeleteMissing}
            onCheckedChange={(checked) => setSyncDeleteMissing(Boolean(checked))}
            disabled={isExporting || isImporting}
          >
            同步刪除缺少單號+商品編號
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {isImporting && importProgress && (
        <span className="text-xs text-muted-foreground whitespace-nowrap" aria-live="polite">
          進度：{importProgress.stage} {Math.min(importProgress.processed, Math.max(1, importProgress.total))}/
          {Math.max(1, importProgress.total)}（
          {Math.min(
            100,
            Math.round((Math.min(importProgress.processed, Math.max(1, importProgress.total)) / Math.max(1, importProgress.total)) * 100),
          )}
          %）
        </span>
      )}
    </div>
  )
}
