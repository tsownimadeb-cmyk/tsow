"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Download, Upload } from "lucide-react"
import Papa from "papaparse"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

type PurchaseCsvRow = {
  order_no: string
  purchase_date: string
  vendor_code: string
  supplier_name: string
  item_code: string
  product_name: string
  spec: string
  quantity: number
  unit_price: number
  amount: number
}

type OrderRow = {
  id: string
  order_no: string
  order_date: string | null
  supplier_id: string | null
}

const CSV_COLUMNS: Array<keyof PurchaseCsvRow> = [
  "order_no",
  "purchase_date",
  "vendor_code",
  "supplier_name",
  "item_code",
  "product_name",
  "spec",
  "quantity",
  "unit_price",
  "amount",
]

async function queryProductsForExport(supabase: ReturnType<typeof createClient>): Promise<Map<string, { name: string; spec: string }>> {
  const attempts = [
    "code,name,spec",
    "pno,pname,spec",
  ]

  for (const selectText of attempts) {
    const result = await supabase.from("products").select(selectText)
    if (!result.error) {
      const rows = (result.data || []) as any[]
      const productMap = new Map<string, { name: string; spec: string }>()
      for (const row of rows) {
        const code = String(row.code ?? row.pno ?? "").trim()
        if (!code) continue
        productMap.set(code, {
          name: String(row.name ?? row.pname ?? "").trim(),
          spec: String(row.spec ?? "").trim(),
        })
      }
      return productMap
    }
  }

  return new Map<string, { name: string; spec: string }>()
}

async function querySuppliersForExport(supabase: ReturnType<typeof createClient>): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("suppliers").select("id,name")
  if (error) {
    return new Map<string, string>()
  }

  const supplierMap = new Map<string, string>()
  for (const row of (data || []) as any[]) {
    const id = String(row.id ?? "").trim()
    if (!id) continue
    supplierMap.set(id, String(row.name ?? "").trim())
  }
  return supplierMap
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

function normalizeKey(key: string) {
  return String(key || "")
    .replace(/^\uFEFF/g, "")
    .trim()
    .toLowerCase()
}

function sanitizeCsvHeader(header: string) {
  return String(header || "")
    .replace(/\uFEFF/g, "")
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060]/g, "")
    .trim()
}

function toNumberOrZero(value: string) {
  if (!value?.trim()) return 0
  const parsed = Number(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

async function queryOrders(supabase: ReturnType<typeof createClient>) {
  const attempts = [
    "id,order_no,order_date,supplier_id",
    "id,order_number,order_date,supplier_id",
  ]

  for (const selectText of attempts) {
    const result = await supabase.from("purchase_orders").select(selectText)
    if (!result.error) {
      const rows = (result.data || []).map((row: any) => ({
        id: String(row.id ?? ""),
        order_no: String(row.order_no ?? row.order_number ?? "").trim(),
        order_date: row.order_date ?? null,
        supplier_id: row.supplier_id ?? null,
      }))
      return rows as OrderRow[]
    }
  }

  throw new Error("讀取進貨單失敗")
}

async function queryProductsCodes(supabase: ReturnType<typeof createClient>) {
  const attempts = ["code", "pno"]
  for (const selectText of attempts) {
    const result = await supabase.from("products").select(selectText)
    if (!result.error) {
      const codes = (result.data || [])
        .map((row: any) => String(row.code ?? row.pno ?? "").trim())
        .filter(Boolean)
      return new Set(codes)
    }
  }
  throw new Error("讀取商品資料失敗")
}

async function querySupplierIds(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase.from("suppliers").select("id")
  if (error) throw new Error(error.message || "讀取供應商資料失敗")
  return new Set((data || []).map((row: any) => String(row.id ?? "").trim()).filter(Boolean))
}

async function queryExistingItemIdsByOrderAndCode(
  supabase: ReturnType<typeof createClient>,
  ordersById: Map<string, OrderRow>,
) {
  const attempts = [
    "id,order_no,code",
    "id,purchase_order_id,code",
    "id,order_no,product_pno",
    "id,purchase_order_id,product_pno",
  ]

  for (const selectText of attempts) {
    const result = await supabase.from("purchase_order_items").select(selectText)
    if (!result.error) {
      const keyToId = new Map<string, string>()
      const rows = (result.data || []) as any[]
      for (const row of rows) {
        const orderNo = String(row.order_no ?? ordersById.get(String(row.purchase_order_id ?? ""))?.order_no ?? "").trim()
        const itemCode = String(row.code ?? row.product_pno ?? "").trim()
        const id = String(row.id ?? "").trim()
        if (!orderNo || !itemCode || !id) continue
        keyToId.set(`${orderNo}::${itemCode}`, id)
      }
      return keyToId
    }
  }

  throw new Error("讀取進貨明細失敗")
}

async function recalculatePurchaseStocks(supabase: ReturnType<typeof createClient>) {
  const itemAttempts = [
    "code,quantity",
    "product_pno,quantity",
  ]

  let codeTotals = new Map<string, number>()
  let itemsLoaded = false

  for (const selectText of itemAttempts) {
    const itemsResult = await supabase.from("purchase_order_items").select(selectText)
    if (itemsResult.error) continue

    const nextTotals = new Map<string, number>()
    const itemRows = (itemsResult.data || []) as any[]
    for (const itemRow of itemRows) {
      const itemCode = String(itemRow.code ?? itemRow.product_pno ?? "").trim()
      if (!itemCode) continue
      const quantity = Number(itemRow.quantity ?? 0)
      nextTotals.set(itemCode, (nextTotals.get(itemCode) || 0) + (Number.isFinite(quantity) ? quantity : 0))
    }

    codeTotals = nextTotals
    itemsLoaded = true
    break
  }

  if (!itemsLoaded) {
    throw new Error("重算庫存失敗：無法讀取進貨明細")
  }

  const productAttempts = [
    "code,stock_qty,purchase_qty_total",
    "code,stock_qty",
    "pno,stock_quantity,purchase_qty_total",
    "pno,stock_quantity",
  ]

  for (const selectText of productAttempts) {
    const productsResult = await supabase.from("products").select(selectText)
    if (productsResult.error) continue

    const productRows = (productsResult.data || []) as any[]
    for (const productRow of productRows) {
      const itemCode = String(productRow.code ?? productRow.pno ?? "").trim()
      if (!itemCode) continue

      const nextPurchaseTotal = Number(codeTotals.get(itemCode) || 0)
      const currentPurchaseTotal = Number(productRow.purchase_qty_total ?? 0)
      const currentStockQty = Number(productRow.stock_qty ?? productRow.stock_quantity ?? 0)
      const delta = nextPurchaseTotal - currentPurchaseTotal
      const nextStockQty = Math.max(0, currentStockQty + delta)

      const payload =
        productRow.code !== undefined
          ? { stock_qty: nextStockQty, purchase_qty_total: nextPurchaseTotal }
          : { stock_quantity: nextStockQty, purchase_qty_total: nextPurchaseTotal }

      const eqColumn = productRow.code !== undefined ? "code" : "pno"
      const { error: updateError } = await supabase.from("products").update(payload).eq(eqColumn, itemCode)
      if (updateError) {
        throw new Error(updateError.message || `商品 ${itemCode} 庫存重算失敗`)
      }
    }

    return
  }

  throw new Error("重算庫存失敗：無法讀取商品資料")
}

export function PurchasesBatchActions() {
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const handleExportCsv = async () => {
    try {
      setIsExporting(true)
      const supabase = createClient()
      const orders = await queryOrders(supabase)
      const orderById = new Map(orders.map((order) => [order.id, order]))
      const orderByNo = new Map(orders.map((order) => [order.order_no, order]))
      const productByCode = await queryProductsForExport(supabase)
      const supplierNameById = await querySuppliersForExport(supabase)

      const itemAttempts = [
        "id,order_no,purchase_order_id,code,quantity,unit_price,subtotal",
        "id,order_no,purchase_order_id,product_pno,quantity,unit_price,subtotal",
        "id,purchase_order_id,code,quantity,unit_price,subtotal",
        "id,purchase_order_id,product_pno,quantity,unit_price,subtotal",
      ]

      let itemRows: any[] = []
      let loaded = false

      for (const selectText of itemAttempts) {
        const result = await supabase.from("purchase_order_items").select(selectText)
        if (!result.error) {
          itemRows = result.data || []
          loaded = true
          break
        }
      }

      if (!loaded) {
        throw new Error("讀取進貨明細失敗")
      }

      const exportRows: PurchaseCsvRow[] = itemRows.map((item) => {
        const orderNo = String(item.order_no ?? orderById.get(String(item.purchase_order_id ?? ""))?.order_no ?? "").trim()
        const order = orderByNo.get(orderNo)
        const itemCode = String(item.code ?? item.product_pno ?? "").trim()
        const product = productByCode.get(itemCode)
        const quantity = Number(item.quantity ?? 0)
        const unitPrice = Number(item.unit_price ?? 0)
        const amount = Number(item.subtotal ?? (quantity * unitPrice))
        const vendorCode = String(order?.supplier_id ?? "")

        return {
          order_no: orderNo,
          purchase_date: String(order?.order_date ?? ""),
          vendor_code: vendorCode,
          supplier_name: supplierNameById.get(vendorCode) || "",
          item_code: itemCode,
          product_name: product?.name || "",
          spec: product?.spec || "",
          quantity,
          unit_price: unitPrice,
          amount,
        }
      })

      const header = CSV_COLUMNS.join(",")
      const bodyRows = exportRows.map((row) => CSV_COLUMNS.map((column) => escapeCsvValue(row[column])).join(","))
      const csvContent = `\uFEFF${[header, ...bodyRows].join("\n")}`

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
      toast({
        title: "錯誤",
        description: error?.message || "匯出進貨明細 CSV 失敗",
        variant: "destructive",
      })
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

    const isConfirmed = window.confirm("這將根據單號與商品編號覆蓋進貨明細，確定執行嗎？")
    if (!isConfirmed) return

    try {
      setIsImporting(true)
      const supabase = createClient()

      const rawText = await file.text()
      const text = rawText.replace(/^\uFEFF/, "")
      const results = await new Promise<Papa.ParseResult<Record<string, unknown>>>((resolve, reject) => {
        Papa.parse<Record<string, unknown>>(text, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: true,
          transformHeader: (header) => sanitizeCsvHeader(header),
          complete: (parsedResults) => resolve(parsedResults),
          error: (error: Error) => reject(error),
        })
      })

      if (results.errors.length > 0) {
        console.warn("[PurchasesBatchActions][Import] CSV parse warnings:", results.errors)
      }

      const rawRows = (results.data || []) as Record<string, unknown>[]
      if (rawRows.length === 0) {
        throw new Error("CSV 內容不足，至少需要標題列與一筆資料")
      }

      const firstRow = (results.data?.[0] || {}) as Record<string, unknown>
      const detectedHeaders = Object.keys(firstRow)
      const normalizedHeaderMap = new Map<string, string>()
      for (const header of detectedHeaders) {
        const normalized = normalizeKey(header)
        if (!normalizedHeaderMap.has(normalized)) {
          normalizedHeaderMap.set(normalized, header)
        }
      }

      if (!normalizedHeaderMap.has("order_no") && detectedHeaders[0]) {
        normalizedHeaderMap.set("order_no", detectedHeaders[0])
      }

      const mappedRows = rawRows.map((row) => {
        const mapped: Record<string, unknown> = {}
        normalizedHeaderMap.forEach((sourceHeader, normalizedKey) => {
          mapped[normalizedKey] = row[sourceHeader]
        })
        return mapped
      })

      const parsedRows = mappedRows.flatMap((row) => {
        const rowAny = row as Record<string, unknown>
        if (!rowAny.order_no && !rowAny[Object.keys(rowAny)[0]]) return []

        const orderNo = (rowAny["order_no"] ?? "").toString().trim()
        if (!orderNo) {
          const firstKey = Object.keys(rowAny)[0] || ""
          if (firstKey) {
            const hexEncoded = Array.from(firstKey)
              .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
              .join(" ")
            console.log("[PurchasesBatchActions][Import][order_no debug]", {
              firstKey,
              length: firstKey.length,
              hex: hexEncoded,
            })
          }
          return []
        }

        const purchaseDate = String(rowAny["purchase_date"] ?? "").trim()
        const vendorCode = String(rowAny["vendor_code"] ?? "").trim()
        const itemCode = String(rowAny["item_code"] ?? "").trim()
        const quantityText = String(rowAny["quantity"] ?? "").trim()
        const unitPriceText = String(rowAny["unit_price"] ?? "").trim()
        const amountText = String(rowAny["amount"] ?? "").trim()

        const quantity = toNumberOrZero(quantityText)
        const unitPrice = toNumberOrZero(unitPriceText)
        const amount = amountText ? toNumberOrZero(amountText) : quantity * unitPrice

        return [{
          order_no: orderNo,
          purchase_date: purchaseDate,
          vendor_code: vendorCode,
          item_code: itemCode,
          quantity,
          unit_price: unitPrice,
          amount,
        }]
      })

      if (parsedRows.length === 0) {
        throw new Error("欄位解析成功，但內容為空。請檢查 Excel 第一列下方是否有資料。")
      }

      const orders = await queryOrders(supabase)
      const orderByNo = new Map(orders.map((order) => [order.order_no, order]))
      const orderById = new Map(orders.map((order) => [order.id, order]))
      const productCodes = await queryProductsCodes(supabase)
      const supplierIds = await querySupplierIds(supabase)

      const headerUpdates = new Map<string, { order_date: string; supplier_id: string | null }>()

      for (const row of parsedRows) {
        if (!row.order_no) {
          throw new Error("匯入資料缺少 order_no")
        }

        const order = orderByNo.get(row.order_no)
        if (!order) {
          throw new Error(`order_no ${row.order_no} 不存在`) 
        }

        if (!row.item_code || !productCodes.has(row.item_code)) {
          throw new Error(`order_no ${row.order_no} 的 item_code ${row.item_code || "(空白)"} 不存在`)
        }

        if (row.vendor_code && !supplierIds.has(row.vendor_code)) {
          throw new Error(`order_no ${row.order_no} 的 vendor_code ${row.vendor_code} 不存在`)
        }

        const orderDate = row.purchase_date || String(order.order_date || "")
        const supplierId = row.vendor_code || String(order.supplier_id || "") || null
        const current = headerUpdates.get(row.order_no)

        if (current && (current.order_date !== orderDate || String(current.supplier_id || "") !== String(supplierId || ""))) {
          throw new Error(`order_no ${row.order_no} 的單頭資料不一致，請確認 purchase_date / vendor_code`)
        }

        headerUpdates.set(row.order_no, { order_date: orderDate, supplier_id: supplierId })
      }

      const existingItemIdByKey = await queryExistingItemIdsByOrderAndCode(supabase, orderById)

      for (const [orderNo, header] of headerUpdates.entries()) {
        const { error: orderUpdateError } = await supabase
          .from("purchase_orders")
          .update({ order_date: header.order_date || null, supplier_id: header.supplier_id })
          .eq("order_no", orderNo)

        if (orderUpdateError) {
          const { error: fallbackUpdateError } = await supabase
            .from("purchase_orders")
            .update({ order_date: header.order_date || null, supplier_id: header.supplier_id })
            .eq("order_number", orderNo)

          if (fallbackUpdateError) {
            throw new Error(`order_no ${orderNo} 單頭更新失敗：${fallbackUpdateError.message || orderUpdateError.message}`)
          }
        }
      }

      const baseRows = parsedRows.map((row) => {
        const id = existingItemIdByKey.get(`${row.order_no}::${row.item_code}`)
        const order = orderByNo.get(row.order_no)
        if (!order) {
          throw new Error(`order_no ${row.order_no} 不存在`)
        }

        return {
          id,
          order_no: row.order_no,
          purchase_order_id: order.id,
          code: row.item_code,
          product_pno: row.item_code,
          quantity: row.quantity,
          unit_price: row.unit_price,
          subtotal: row.amount,
        }
      })

      const payloadAttempts = [
        baseRows.map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          order_no: row.order_no,
          code: row.code,
          quantity: row.quantity,
          unit_price: row.unit_price,
          subtotal: row.subtotal,
        })),
        baseRows.map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          purchase_order_id: row.purchase_order_id,
          code: row.code,
          quantity: row.quantity,
          unit_price: row.unit_price,
          subtotal: row.subtotal,
        })),
        baseRows.map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          purchase_order_id: row.purchase_order_id,
          product_pno: row.product_pno,
          quantity: row.quantity,
          unit_price: row.unit_price,
          subtotal: row.subtotal,
        })),
      ]

      let upsertSuccess = false
      let lastUpsertError: any = null

      for (const payload of payloadAttempts) {
        const result = await supabase
          .from("purchase_order_items")
          .upsert(payload, { onConflict: "id" })

        if (!result.error) {
          upsertSuccess = true
          break
        }

        lastUpsertError = result.error
      }

      if (!upsertSuccess) {
        throw new Error(lastUpsertError?.message || "進貨明細 upsert 失敗")
      }

      await recalculatePurchaseStocks(supabase)

      toast({
        title: "成功",
        description: "進貨資料批次更新完成",
      })
      router.refresh()
    } catch (error: any) {
      toast({
        title: "錯誤",
        description: error?.message || "匯入批次修改失敗",
        variant: "destructive",
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
      <Button variant="outline" onClick={handleExportCsv} disabled={isExporting || isImporting}>
        <Download className="mr-2 h-4 w-4" />
        {isExporting ? "匯出中..." : "匯出進貨明細 CSV"}
      </Button>
      <Button variant="outline" onClick={handleImportClick} disabled={isExporting || isImporting}>
        <Upload className="mr-2 h-4 w-4" />
        {isImporting ? "匯入中..." : "匯入批次修改"}
      </Button>
    </>
  )
}