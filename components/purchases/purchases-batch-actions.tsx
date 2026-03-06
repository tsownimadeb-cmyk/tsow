"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Download, Settings, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { recalculateProductCostsByCodes } from "@/lib/product-cost-recalculation"
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

type PurchaseCsvRow = {
  order_no: string
  item_code: string
  quantity: number
  unit_price: number
  purchase_date: string
  vendor_code: string
}

type PurchaseExportCsvRow = PurchaseCsvRow & {
  shipping_fee: number
  is_paid: string
}

type ParsedPurchaseRow = PurchaseCsvRow & {
  row_no: number
  subtotal: number
  is_paid_input: boolean | null
  shipping_fee_input: number | null
}

type OrderRow = {
  id: string
  order_no: string
  order_date: string | null
  supplier_id: string | null
  shipping_fee: number
  is_paid: boolean | null
  total_amount: number
}

type ImportProgress = {
  stage: string
  processed: number
  total: number
}

const CSV_COLUMNS: Array<keyof PurchaseCsvRow> = [
  "order_no",
  "item_code",
  "quantity",
  "unit_price",
  "purchase_date",
  "vendor_code",
]

const EXPORT_CSV_COLUMNS: Array<keyof PurchaseExportCsvRow> = [...CSV_COLUMNS, "shipping_fee", "is_paid"]
const IN_FILTER_CHUNK_SIZE = 50
const WRITE_BATCH_SIZE = 300

const IMPORT_HEADER_ALIAS_MAP: Record<string, keyof PurchaseExportCsvRow> = {
  order_no: "order_no",
  orderno: "order_no",
  item_code: "item_code",
  code: "item_code",
  quantity: "quantity",
  qty: "quantity",
  unit_price: "unit_price",
  unitprice: "unit_price",
  purchase_date: "purchase_date",
  order_date: "purchase_date",
  vendor_code: "vendor_code",
  vendol_code: "vendor_code",
  supplier_id: "vendor_code",
  shipping_fee: "shipping_fee",
  shipping_fei: "shipping_fee",
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

function normalizeImportHeader(header: string): string {
  const sanitized = sanitizeCsvHeader(header)
  const key = sanitized.toLowerCase().replace(/\s+/g, "_")
  return IMPORT_HEADER_ALIAS_MAP[key] || sanitized
}

function toNumberOrZero(value: string) {
  if (!value?.trim()) return 0
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
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

function toOptionalNumber(value: string) {
  const normalized = String(value || "").trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  return Number.isNaN(parsed) ? null : parsed
}

function parseBooleanInput(value: string) {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) return null
  if (["true", "1", "yes", "y"].includes(normalized)) return true
  if (["false", "0", "no", "n"].includes(normalized)) return false
  return null
}

function isShippingFeeColumnMissing(error: any) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("shipping_fee") && (message.includes("column") || message.includes("schema cache"))
}

function normalizeDateInput(value: string) {
  const raw = String(value || "").trim()
  if (!raw) return ""

  const normalized = raw.replace(/[.]/g, "-").replace(/[\/]/g, "-")
  const parts = normalized.split("-").map((part) => part.trim()).filter(Boolean)
  if (parts.length !== 3) return raw

  const [year, month, day] = parts
  if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) {
    return raw
  }

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
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

async function queryOrders(supabase: ReturnType<typeof createClient>) {
  const pageSize = 1000
  const allRows: any[] = []

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const result = await supabase
      .from("purchase_orders")
      .select("id,order_no,order_date,supplier_id,shipping_fee,is_paid,total_amount")
      .order("id", { ascending: true })
      .range(from, to)

    if (result.error) throw new Error("讀取進貨單失敗")

    const batch = result.data || []
    allRows.push(...batch)

    if (batch.length < pageSize) break
  }

  const rows = allRows.map((row: any) => ({
    id: String(row.id ?? ""),
    order_no: String(row.order_no ?? "").trim(),
    order_date: row.order_date ?? null,
    supplier_id: row.supplier_id ?? null,
    shipping_fee: Number(row.shipping_fee ?? 0),
    is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
    total_amount: Number(row.total_amount ?? 0),
  }))
  return rows as OrderRow[]
}

async function recalculatePurchaseOrderTotals(supabase: ReturnType<typeof createClient>, targetOrderIds: string[]) {
  const normalizedOrderIds = Array.from(new Set((targetOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  if (normalizedOrderIds.length === 0) {
    return
  }

  const allItemRows: any[] = []
  for (const orderIdChunk of chunkArray(normalizedOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const { data: itemRows, error: itemError } = await supabase
      .from("purchase_order_items")
      .select("purchase_order_id,subtotal")
      .in("purchase_order_id", orderIdChunk)

    if (itemError) {
      throw new Error(formatSupabaseError(itemError, "重算進貨單總額失敗"))
    }

    allItemRows.push(...((itemRows || []) as any[]))
  }

  const totalByOrderId = new Map<string, number>()
  for (const row of allItemRows) {
    const orderId = String(row.purchase_order_id ?? "").trim()
    if (!orderId) continue
    const subtotal = Number(row.subtotal ?? 0)
    totalByOrderId.set(orderId, Number(totalByOrderId.get(orderId) || 0) + (Number.isFinite(subtotal) ? subtotal : 0))
  }

  for (const orderIdChunk of chunkArray(normalizedOrderIds, IN_FILTER_CHUNK_SIZE)) {
    await Promise.all(
      orderIdChunk.map(async (orderId) => {
        const nextTotalAmount = Number(totalByOrderId.get(orderId) || 0)
        const { error: updateError } = await supabase
          .from("purchase_orders")
          .update({ total_amount: nextTotalAmount })
          .eq("id", orderId)

        if (updateError) {
          throw new Error(formatSupabaseError(updateError, `更新進貨單 ${orderId} 總額失敗`))
        }
      }),
    )
  }
}

async function queryOrdersByIds(supabase: ReturnType<typeof createClient>, targetOrderIds: string[]) {
  const normalizedOrderIds = Array.from(new Set((targetOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  if (normalizedOrderIds.length === 0) {
    return [] as OrderRow[]
  }

  const rows: any[] = []
  for (const orderIdChunk of chunkArray(normalizedOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const result = await supabase
      .from("purchase_orders")
      .select("id,order_no,order_date,supplier_id,shipping_fee,is_paid,total_amount")
      .in("id", orderIdChunk)

    if (result.error) {
      throw new Error(formatSupabaseError(result.error, "讀取目標進貨單失敗"))
    }

    rows.push(...(result.data || []))
  }

  return rows.map((row: any) => ({
    id: String(row.id ?? ""),
    order_no: String(row.order_no ?? "").trim(),
    order_date: row.order_date ?? null,
    supplier_id: row.supplier_id ?? null,
    shipping_fee: Number(row.shipping_fee ?? 0),
    is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
    total_amount: Number(row.total_amount ?? 0),
  })) as OrderRow[]
}

async function syncAccountsPayable(supabase: ReturnType<typeof createClient>, targetOrderIds: string[]) {
  const normalizedOrderIds = Array.from(new Set((targetOrderIds || []).map((id) => String(id || "").trim()).filter(Boolean)))
  if (normalizedOrderIds.length === 0) {
    return
  }

  const orders = await queryOrdersByIds(supabase, normalizedOrderIds)

  const existingRows: any[] = []
  for (const orderIdChunk of chunkArray(normalizedOrderIds, IN_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("accounts_payable")
      .select("id,purchase_order_id")
      .in("purchase_order_id", orderIdChunk)

    if (error) {
      throw new Error(formatSupabaseError(error, "同步應付帳款失敗"))
    }

    existingRows.push(...((data || []) as any[]))
  }

  const apByPurchaseOrderId = new Map<string, string>()
  for (const row of existingRows) {
    const purchaseOrderId = String(row.purchase_order_id ?? "").trim()
    const apId = String(row.id ?? "").trim()
    if (!purchaseOrderId || !apId) continue
    apByPurchaseOrderId.set(purchaseOrderId, apId)
  }

  const upsertRows: Array<{
    purchase_order_id: string
    supplier_id: string | null
    amount_due: number
    total_amount: number
    paid_amount: number
    due_date: string | null
    status: string
  }> = []

  for (const order of orders) {
    if (!order.id) continue

    const totalAmount = Number(order.total_amount || 0)
    const paid = Boolean(order.is_paid)

    const payload = {
      supplier_id: order.supplier_id,
      amount_due: totalAmount,
      total_amount: totalAmount,
      paid_amount: paid ? totalAmount : 0,
      due_date: normalizeDateInput(String(order.order_date || "")) || null,
      status: paid ? "paid" : "unpaid",
    }

    upsertRows.push({
      purchase_order_id: order.id,
      ...payload,
    })
  }

  if (upsertRows.length > 0) {
    for (const payloadChunk of chunkArray(upsertRows, WRITE_BATCH_SIZE)) {
      const { error: upsertError } = await supabase
        .from("accounts_payable")
        .upsert(payloadChunk, { onConflict: "purchase_order_id", on_conflict: "purchase_order_id" } as any)

      if (upsertError) {
        // Fallback for environments without unique constraint on purchase_order_id.
        for (const row of payloadChunk) {
          const existingId = apByPurchaseOrderId.get(String(row.purchase_order_id || "").trim())
          if (existingId) {
            const { error: updateError } = await supabase
              .from("accounts_payable")
              .update({
                supplier_id: row.supplier_id,
                amount_due: row.amount_due,
                total_amount: row.total_amount,
                paid_amount: row.paid_amount,
                due_date: row.due_date,
                status: row.status,
              })
              .eq("id", existingId)
            if (updateError) {
              throw new Error(formatSupabaseError(updateError, "更新應付帳款失敗"))
            }
          } else {
            const { error: insertError } = await supabase.from("accounts_payable").insert(row)
            if (insertError) {
              throw new Error(formatSupabaseError(insertError, "建立應付帳款失敗"))
            }
          }
        }
      }
    }
  }
}

async function queryProductsCodes(supabase: ReturnType<typeof createClient>) {
  const pageSize = 1000
  const attempts = [
    { selectText: "code,pno", orderColumn: "code" },
    { selectText: "code", orderColumn: "code" },
    { selectText: "pno", orderColumn: "pno" },
  ]

  for (const attempt of attempts) {
    const codes = new Set<string>()
    let hasQueryError = false

    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1
      const result = await supabase
        .from("products")
        .select(attempt.selectText)
        .order(attempt.orderColumn, { ascending: true })
        .range(from, to)

      if (result.error) {
        hasQueryError = true
        break
      }

      const batch = result.data || []
      for (const row of batch as any[]) {
        const code = String(row.code ?? row.pno ?? "").trim().toUpperCase()
        if (code) codes.add(code)
      }

      if (batch.length < pageSize) break
    }

    if (!hasQueryError) {
      return codes
    }
  }

  throw new Error("讀取商品資料失敗")
}

async function querySupplierIds(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.from("suppliers").select("id")
  if (error) throw new Error(error.message || "讀取供應商資料失敗")
  return new Set((data || []).map((row: any) => String(row.id ?? "").trim()).filter(Boolean))
}

async function createPurchaseOrderByOrderNo(
  supabase: ReturnType<typeof createClient>,
  orderNo: string,
  orderDate: string,
  supplierId: string | null,
) {
  const normalizedOrderNo = String(orderNo || "").trim()
  if (!normalizedOrderNo) {
    throw new Error("建立進貨單失敗：order_no 不可為空")
  }

  const payloadBase = {
    order_date: orderDate || null,
    supplier_id: supplierId,
    total_amount: 0,
    status: "pending",
    is_paid: false,
  }

  const { error } = await supabase.from("purchase_orders").insert({ ...payloadBase, order_no: normalizedOrderNo })
  if (!error) return
  if (String(error?.code || "") === "23505") return
  throw new Error(formatSupabaseError(error, `建立進貨單 ${normalizedOrderNo} 失敗`))
}

async function queryExistingItemIdsByOrderAndCode(
  supabase: ReturnType<typeof createClient>,
  ordersById: Map<string, OrderRow>,
  targetOrderIds?: string[],
) {
  const data: any[] = []
  if (targetOrderIds && targetOrderIds.length > 0) {
    for (const orderIdChunk of chunkArray(targetOrderIds, IN_FILTER_CHUNK_SIZE)) {
      const result = await supabase
        .from("purchase_order_items")
        .select("id,purchase_order_id,order_no,code")
        .in("purchase_order_id", orderIdChunk)

      if (result.error) {
        throw new Error(formatSupabaseError(result.error, "讀取進貨明細失敗"))
      }

      data.push(...((result.data || []) as any[]))
    }
  } else {
    const result = await supabase.from("purchase_order_items").select("id,purchase_order_id,order_no,code")
    if (result.error) {
      throw new Error(formatSupabaseError(result.error, "讀取進貨明細失敗"))
    }
    data.push(...((result.data || []) as any[]))
  }

  const keyToId = new Map<string, string>()
  for (const row of data) {
    const orderNo = String(row.order_no ?? ordersById.get(String(row.purchase_order_id ?? ""))?.order_no ?? "").trim()
    const itemCode = String(row.code ?? "").trim()
    const id = String(row.id ?? "").trim()
    if (!orderNo || !itemCode || !id) continue
    keyToId.set(`${orderNo}::${itemCode}`, id)
  }

  return keyToId
}

async function recalculateStockForCodes(supabase: ReturnType<typeof createClient>, targetCodes: string[]) {
  const normalizedCodes = Array.from(
    new Set((targetCodes || []).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean)),
  )
  if (normalizedCodes.length === 0) {
    return
  }

  const purchaseTotals = new Map<string, number>()
  const salesTotals = new Map<string, number>()

  for (const codeChunk of chunkArray(normalizedCodes, IN_FILTER_CHUNK_SIZE)) {
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
  }

  for (const codeChunk of chunkArray(normalizedCodes, IN_FILTER_CHUNK_SIZE)) {
    await Promise.all(
      codeChunk.map(async (code) => {
        const purchaseQty = Number(purchaseTotals.get(code) || 0)
        const salesQty = Number(salesTotals.get(code) || 0)
        const nextStockQty = Math.max(0, purchaseQty - salesQty)
        const { error: updateError } = await supabase
          .from("products")
          .update({ stock_qty: nextStockQty })
          .ilike("code", code)

        if (updateError) {
          throw new Error(formatSupabaseError(updateError, `重算庫存失敗：更新商品 ${code} 失敗`))
        }
      }),
    )
  }
}

export function PurchasesBatchActions() {
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
      const orders = await queryOrders(supabase)
      const orderById = new Map(orders.map((order) => [order.id, order]))

      const pageSize = 1000
      const allItems: any[] = []

      for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1
        const { data, error } = await supabase
          .from("purchase_order_items")
          .select("id,purchase_order_id,code,quantity,unit_price")
          .order("id", { ascending: true })
          .range(from, to)

        if (error) throw error

        const batch = (data || []) as any[]
        allItems.push(...batch)

        if (batch.length < pageSize) {
          break
        }
      }

      const exportRows: PurchaseExportCsvRow[] = allItems.map((item) => {
        const order = orderById.get(String(item.purchase_order_id ?? ""))
        return {
          order_no: String(order?.order_no ?? "").trim(),
          item_code: String(item.code ?? "").trim(),
          quantity: Number(item.quantity ?? 0),
          unit_price: Number(item.unit_price ?? 0),
          purchase_date: String(order?.order_date ?? ""),
          vendor_code: String(order?.supplier_id ?? ""),
          shipping_fee: Number(order?.shipping_fee ?? 0),
          is_paid: order?.is_paid === true ? "true" : "false",
        }
      }).sort((a, b) => {
        const timeA = a.purchase_date ? Date.parse(String(a.purchase_date)) : Number.NaN
        const timeB = b.purchase_date ? Date.parse(String(b.purchase_date)) : Number.NaN
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
      link.download = `purchase_items_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toastApi.error(formatRuntimeError(error, "匯出進貨明細 CSV 失敗"))
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
      const requiredColumns = [...CSV_COLUMNS]
      const headers = [...parsedHeaders]
      for (let index = 0; index < requiredColumns.length; index += 1) {
        const requiredColumn = requiredColumns[index]
        if (!headers.includes(requiredColumn) && index < headers.length) {
          headers[index] = requiredColumn
        }
      }
      for (const requiredColumn of requiredColumns) {
        if (!headers.includes(requiredColumn)) {
          throw new Error(`CSV 缺少必要欄位：${requiredColumn}`)
        }
      }

      const parsedRows: ParsedPurchaseRow[] = []
      let roundedQuantityCount = 0
      const parseTotal = Math.max(csvLines.length - 1, 1)
      csvLines.slice(1).forEach((line, index) => {
        if (index % 200 === 0 || index + 1 === parseTotal) {
          setImportProgress({ stage: "解析 CSV", processed: index + 1, total: parseTotal })
        }
        const values = parseCsvLine(line)
        const valueByColumn = headers.reduce<Record<string, string>>((accumulator, header, columnIndex) => {
          accumulator[header] = values[columnIndex] ?? ""
          return accumulator
        }, {})

        const orderNo = sanitizeCsvCellValue(String(valueByColumn.order_no ?? ""))

        const itemCode = sanitizeCsvCellValue(String(valueByColumn.item_code ?? ""))
        const purchaseDate = sanitizeCsvCellValue(String(valueByColumn.purchase_date ?? ""))
        const vendorCode = sanitizeCsvCellValue(String(valueByColumn.vendor_code ?? ""))
        const quantityText = sanitizeCsvCellValue(String(valueByColumn.quantity ?? ""))
        const unitPriceText = sanitizeCsvCellValue(String(valueByColumn.unit_price ?? ""))
        const shippingFeeText = sanitizeCsvCellValue(String(valueByColumn.shipping_fee ?? ""))
        const isPaidText = sanitizeCsvCellValue(String(valueByColumn.is_paid ?? ""))

        const isCompletelyEmpty = !orderNo && !itemCode && !purchaseDate && !vendorCode && !quantityText && !unitPriceText
        if (isCompletelyEmpty) return

        if (!orderNo) {
          throw new Error(`第 ${index + 2} 列缺少 order_no，請填入你要的新單號`)
        }

        const quantityRaw = toNumberOrZero(quantityText)
        const quantity = toIntegerOrRound(quantityText, index + 2, "quantity")
        if (Number.isFinite(quantityRaw) && !Number.isInteger(quantityRaw)) {
          roundedQuantityCount += 1
        }
        const unitPrice = toNumberOrZero(unitPriceText)
        const shippingFeeInput = toOptionalNumber(shippingFeeText)
        const isPaidInput = parseBooleanInput(isPaidText)

        parsedRows.push({
          row_no: index + 2,
          order_no: orderNo,
          item_code: itemCode,
          quantity,
          unit_price: unitPrice,
          purchase_date: purchaseDate,
          vendor_code: vendorCode,
          subtotal: quantity * unitPrice,
          is_paid_input: isPaidInput,
          shipping_fee_input: shippingFeeInput,
        })
      })

      if (parsedRows.length === 0) {
        throw new Error("沒有可匯入的資料，請確認 item_code 欄位")
      }

      const totalRows = parsedRows.length
      setImportProgress({ stage: "驗證資料", processed: 0, total: totalRows })

      if (syncDeleteMissing) {
        const secondConfirm = window.confirm(
          "已啟用同步刪除：系統將刪除所有不在 CSV 內的進貨明細（order_no + item_code）。此操作無法復原，確定繼續嗎？",
        )
        if (!secondConfirm) return
      }

      const supabase = createClient()
      const [initialOrders, productCodes, supplierIds] = await Promise.all([
        queryOrders(supabase),
        queryProductsCodes(supabase),
        querySupplierIds(supabase),
      ])

      const orderByNo = new Map(initialOrders.map((order) => [order.order_no, order]))
      const missingOrderNos = new Set<string>()

      for (let rowIndex = 0; rowIndex < parsedRows.length; rowIndex += 1) {
        const row = parsedRows[rowIndex]
        if (rowIndex % 200 === 0 || rowIndex + 1 === parsedRows.length) {
          setImportProgress({ stage: "驗證資料", processed: rowIndex + 1, total: totalRows })
        }
        const normalizedItemCode = String(row.item_code || "").trim().toUpperCase()
        if (!normalizedItemCode || !productCodes.has(normalizedItemCode)) {
          throw new Error(`第 ${row.row_no} 列失敗：item_code ${row.item_code || "(空白)"} 不存在`)
        }

        if (row.vendor_code && !supplierIds.has(row.vendor_code)) {
          throw new Error(`第 ${row.row_no} 列失敗：vendor_code ${row.vendor_code} 不存在`)
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
            order_date: normalizeDateInput(sampleRow.purchase_date) || null,
            supplier_id: String(sampleRow.vendor_code || "").trim() || null,
            total_amount: 0,
            status: "pending",
            is_paid: false,
          }
        })
        .filter((row): row is {
          order_no: string
          order_date: string | null
          supplier_id: string | null
          total_amount: number
          status: string
          is_paid: boolean
        } => Boolean(row))

      if (missingOrderPayload.length > 0) {
        for (const payloadChunk of chunkArray(missingOrderPayload, WRITE_BATCH_SIZE)) {
          const { error: createMissingOrdersError } = await supabase
            .from("purchase_orders")
            .upsert(payloadChunk, { onConflict: "order_no", on_conflict: "order_no" } as any)

          if (createMissingOrdersError) {
            throw new Error(formatSupabaseError(createMissingOrdersError, "建立缺少進貨單失敗"))
          }
        }
      }

      let orders = await queryOrders(supabase)
      let latestOrderByNo = new Map(orders.map((order) => [order.order_no, order]))
      let orderById = new Map(orders.map((order) => [order.id, order]))
      const targetOrderIds = Array.from(
        new Set(
          parsedRows
            .map((row) => String(latestOrderByNo.get(row.order_no)?.id || "").trim())
            .filter(Boolean),
        ),
      )
      const affectedProductCodes = new Set(
        parsedRows
          .map((row) => String(row.item_code || "").trim().toUpperCase())
          .filter(Boolean),
      )
      const headerUpdates = new Map<string, { order_date: string; supplier_id: string | null; is_paid: boolean; shipping_fee: number }>()

      for (const row of parsedRows) {
        let order = latestOrderByNo.get(row.order_no)
        if (!order) {
          await createPurchaseOrderByOrderNo(
            supabase,
            row.order_no,
            normalizeDateInput(row.purchase_date),
            String(row.vendor_code || "").trim() || null,
          )
          orders = await queryOrders(supabase)
          latestOrderByNo = new Map(orders.map((nextOrder) => [nextOrder.order_no, nextOrder]))
          orderById = new Map(orders.map((nextOrder) => [nextOrder.id, nextOrder]))
          order = latestOrderByNo.get(row.order_no)
        }
        if (!order) {
          throw new Error(`第 ${row.row_no} 列失敗：order_no ${row.order_no} 不存在`)
        }

        const current = headerUpdates.get(row.order_no)
        const mergedOrderDate =
          normalizeDateInput(row.purchase_date) ||
          current?.order_date ||
          normalizeDateInput(String(order.order_date || "")) ||
          ""
        const mergedSupplierId =
          String(row.vendor_code || "").trim() ||
          current?.supplier_id ||
          (String(order.supplier_id || "").trim() || null)
        const mergedIsPaid =
          row.is_paid_input === null || row.is_paid_input === undefined
            ? (current?.is_paid ?? Boolean(order.is_paid))
            : row.is_paid_input
        const mergedShippingFee =
          row.shipping_fee_input === null || row.shipping_fee_input === undefined
            ? (current?.shipping_fee ?? Number(order.shipping_fee || 0))
            : Number(row.shipping_fee_input)

        headerUpdates.set(row.order_no, {
          order_date: mergedOrderDate,
          supplier_id: mergedSupplierId,
          is_paid: mergedIsPaid,
          shipping_fee: Number(mergedShippingFee || 0),
        })
      }

      const headerUpdatePayload = Array.from(headerUpdates.entries()).map(([orderNo, header]) => ({
        order_no: orderNo,
        order_date: header.order_date || null,
        supplier_id: header.supplier_id,
        is_paid: header.is_paid,
        shipping_fee: header.shipping_fee,
      }))

      if (headerUpdatePayload.length > 0) {
        setImportProgress({ stage: "更新單頭", processed: 0, total: totalRows })
        for (const payloadChunk of chunkArray(headerUpdatePayload, WRITE_BATCH_SIZE)) {
          let { error: updateError } = await supabase
            .from("purchase_orders")
            .upsert(payloadChunk, { onConflict: "order_no", on_conflict: "order_no" } as any)

          if (updateError && isShippingFeeColumnMissing(updateError)) {
            const payloadWithoutShipping = payloadChunk.map(({ shipping_fee: _shippingFee, ...rest }) => rest)
            const retryWithoutShipping = await supabase
              .from("purchase_orders")
              .upsert(payloadWithoutShipping, { onConflict: "order_no", on_conflict: "order_no" } as any)
            updateError = retryWithoutShipping.error
          }

          if (updateError) {
            throw new Error(formatSupabaseError(updateError, "批次更新進貨單單頭失敗"))
          }
        }
      }

      const targetOrderNos = Array.from(new Set(parsedRows.map((row) => row.order_no).filter(Boolean)))

      if (targetOrderIds.length > 0) {
        let deleteByOrderIdError: any = null
        for (const orderIdChunk of chunkArray(targetOrderIds, IN_FILTER_CHUNK_SIZE)) {
          const result = await supabase
            .from("purchase_order_items")
            .delete()
            .in("purchase_order_id", orderIdChunk)
          if (result.error) {
            deleteByOrderIdError = result.error
            break
          }
        }

        if (deleteByOrderIdError) {
          let deleteByOrderNoError: any = null
          for (const orderNoChunk of chunkArray(targetOrderNos, IN_FILTER_CHUNK_SIZE)) {
            const result = await supabase
              .from("purchase_order_items")
              .delete()
              .in("order_no", orderNoChunk)
            if (result.error) {
              deleteByOrderNoError = result.error
              break
            }
          }

          if (deleteByOrderNoError) {
            throw new Error(formatSupabaseError(deleteByOrderNoError, deleteByOrderIdError.message || "清除既有進貨明細失敗"))
          }
        }
      }

      const insertPayloadByKey = new Map<string, {
        purchase_order_id: string
        code: string
        quantity: number
        unit_price: number
        subtotal: number
      }>()

      for (const row of parsedRows) {
        let order = latestOrderByNo.get(row.order_no)
        if (!order) {
          await createPurchaseOrderByOrderNo(
            supabase,
            row.order_no,
            normalizeDateInput(row.purchase_date),
            String(row.vendor_code || "").trim() || null,
          )
          orders = await queryOrders(supabase)
          latestOrderByNo = new Map(orders.map((nextOrder) => [nextOrder.order_no, nextOrder]))
          orderById = new Map(orders.map((nextOrder) => [nextOrder.id, nextOrder]))
          order = latestOrderByNo.get(row.order_no)
        }
        if (!order) {
          throw new Error(`第 ${row.row_no} 列失敗：order_no ${row.order_no} 不存在`)
        }

        const payload = {
          purchase_order_id: order.id,
          code: row.item_code,
          quantity: Number(row.quantity),
          unit_price: Number(row.unit_price),
          subtotal: Number(row.subtotal),
        }

        const dedupeKey = `${order.id}::${row.item_code}`

        insertPayloadByKey.set(dedupeKey, payload)
      }

      const insertPayload = Array.from(insertPayloadByKey.values())

      setImportProgress({ stage: "寫入明細", processed: 0, total: totalRows })
      let writtenRows = 0
      for (const payloadChunk of chunkArray(insertPayload, WRITE_BATCH_SIZE)) {
        const { error: insertError } = await supabase
          .from("purchase_order_items")
          .insert(payloadChunk)

        if (insertError) {
          throw new Error(formatSupabaseError(insertError, "匯入進貨明細失敗"))
        }

        writtenRows += payloadChunk.length
        setImportProgress({ stage: "寫入明細", processed: writtenRows, total: totalRows })
      }

      const affectedOrderIds = new Set<string>(targetOrderIds)
      for (const row of insertPayload) {
        const insertedOrderId = String(row.purchase_order_id || "").trim()
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
            if (deletedCode) {
              affectedProductCodes.add(deletedCode)
            }
            const deletedOrder = latestOrderByNo.get(deletedOrderNo)
            if (deletedOrder?.id) {
              affectedOrderIds.add(String(deletedOrder.id))
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

        if (idsToDelete.length > 0) {
          for (const idChunk of chunkArray(idsToDelete, IN_FILTER_CHUNK_SIZE)) {
            const { error: deleteError } = await supabase.from("purchase_order_items").delete().in("id", idChunk)
            if (deleteError) {
              throw new Error(formatSupabaseError(deleteError, "刪除缺少進貨明細失敗"))
            }
          }
        }

        if (orderIdsToDelete.length > 0) {
          for (const orderIdChunk of chunkArray(orderIdsToDelete, IN_FILTER_CHUNK_SIZE)) {
            const { error: deleteItemsByOrderIdError } = await supabase
              .from("purchase_order_items")
              .delete()
              .in("purchase_order_id", orderIdChunk)
            if (deleteItemsByOrderIdError) {
              throw new Error(formatSupabaseError(deleteItemsByOrderIdError, "刪除缺少進貨單明細失敗"))
            }
          }

          for (const orderIdChunk of chunkArray(orderIdsToDelete, IN_FILTER_CHUNK_SIZE)) {
            const { error: deleteApError } = await supabase
              .from("accounts_payable")
              .delete()
              .in("purchase_order_id", orderIdChunk)
            if (deleteApError) {
              throw new Error(formatSupabaseError(deleteApError, "刪除缺少應付帳款失敗"))
            }
          }

          for (const orderIdChunk of chunkArray(orderIdsToDelete, IN_FILTER_CHUNK_SIZE)) {
            const { error: deleteOrdersError } = await supabase
              .from("purchase_orders")
              .delete()
              .in("id", orderIdChunk)
            if (deleteOrdersError) {
              throw new Error(formatSupabaseError(deleteOrdersError, "刪除缺少進貨單失敗"))
            }
          }
        }

        if (orderNosToDelete.length > 0) {
          for (const orderNoChunk of chunkArray(orderNosToDelete, IN_FILTER_CHUNK_SIZE)) {
            await supabase.from("purchase_order_items").delete().in("order_no", orderNoChunk)
          }
          for (const orderNoChunk of chunkArray(orderNosToDelete, IN_FILTER_CHUNK_SIZE)) {
            await supabase.from("purchase_orders").delete().in("order_no", orderNoChunk)
          }
        }
      }

      const orderIdsToRecalculate = Array.from(affectedOrderIds)

      setImportProgress({ stage: "重算與同步", processed: 0, total: 4 })
      await recalculatePurchaseOrderTotals(supabase, orderIdsToRecalculate)
      setImportProgress({ stage: "重算與同步", processed: 1, total: 4 })
      await syncAccountsPayable(supabase, orderIdsToRecalculate)
      setImportProgress({ stage: "重算與同步", processed: 2, total: 4 })

      await recalculateStockForCodes(supabase, Array.from(affectedProductCodes))
      setImportProgress({ stage: "重算與同步", processed: 3, total: 4 })
      await recalculateProductCostsByCodes(supabase, Array.from(affectedProductCodes))
      setImportProgress({ stage: "重算與同步", processed: 4, total: 4 })

      const roundedHint = roundedQuantityCount > 0 ? `（quantity 小數已自動四捨五入 ${roundedQuantityCount} 筆）` : ""
      toastApi.success(`進貨資料批次更新完成${roundedHint}`)
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
            aria-label="進貨單操作"
            title="進貨單操作"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>批次操作</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleExportCsv} disabled={isExporting || isImporting}>
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "匯出中..." : "匯出進貨明細 CSV"}
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
