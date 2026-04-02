"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Download, Upload, Settings } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"

type ProductCsvRow = {
  code: string
  name: string
  spec: string | null
  unit: string | null
  category: string | null
  base_price: number
  cost: number
  price: number
  sale_price: number | null
}

const CSV_COLUMNS: Array<keyof ProductCsvRow> = ["code", "name", "spec", "unit", "category", "base_price", "cost", "price", "sale_price"]

const IMPORT_HEADER_ALIAS_MAP: Record<string, keyof ProductCsvRow> = {
  code: "code",
  pno: "code",
  item_code: "code",
  name: "name",
  pname: "name",
  item_name: "name",
  spec: "spec",
  specification: "spec",
  unit: "unit",
  category: "category",
  cate: "category",
  base_price: "base_price",
  purchase_price: "base_price",
  cost: "cost",
  price: "price",
  sale_price: "sale_price",
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
    const char = line[index]
    const nextChar = line[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === "," && !inQuotes) {
      values.push(currentValue)
      currentValue = ""
      continue
    }

    currentValue += char
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

function toNullableNumber(value: string) {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function isBasePriceColumnMissing(error: any) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("base_price") && (message.includes("column") || message.includes("schema cache"))
}

export function ProductsBatchActions() {
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  // 直接同步刪除，不再需要 UI 控制

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
      const { data, error } = await supabase
        .from("products")
        .select("code,name,spec,unit,category,base_price,cost,price,sale_price")
        .order("code", { ascending: true })

      let products = (data || []) as ProductCsvRow[]
      if (error) {
        if (!isBasePriceColumnMissing(error)) throw error

        const fallback = await supabase
          .from("products")
          .select("code,name,spec,unit,category,purchase_price,cost,price,sale_price")
          .order("code", { ascending: true })

        if (!fallback.error) {
          products = ((fallback.data || []) as Array<{ code: string; name: string; spec: string | null; unit: string | null; category: string | null; purchase_price?: number | null; cost: number; price: number; sale_price: number | null }>).map((row) => ({
            code: row.code,
            name: row.name,
            spec: row.spec,
            unit: row.unit,
            category: row.category,
            base_price: Number(row.purchase_price ?? row.cost ?? 0),
            cost: Number(row.cost ?? 0),
            price: Number(row.price ?? 0),
            sale_price: row.sale_price ?? null,
          }))
        } else {
          const fallbackCostOnly = await supabase
            .from("products")
            .select("code,name,spec,unit,category,cost,price,sale_price")
            .order("code", { ascending: true })

          if (fallbackCostOnly.error) throw fallbackCostOnly.error

          products = ((fallbackCostOnly.data || []) as Array<{ code: string; name: string; spec: string | null; unit: string | null; category: string | null; cost: number; price: number; sale_price: number | null }>).map((row) => ({
            code: row.code,
            name: row.name,
            spec: row.spec,
            unit: row.unit,
            category: row.category,
            base_price: Number(row.cost ?? 0),
            cost: Number(row.cost ?? 0),
            price: Number(row.price ?? 0),
            sale_price: row.sale_price ?? null,
          }))
        }
      }
      const header = CSV_COLUMNS.join(",")
      const rows = products.map((product) =>
        CSV_COLUMNS.map((column) => escapeCsvValue(product[column])).join(","),
      )
      const csvBody = [header, ...rows].join("\n")
      const csvWithBom = `\uFEFF${csvBody}`

      const blob = new Blob([csvWithBom], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      const timestamp = new Date().toISOString().slice(0, 10)

      link.href = url
      link.download = `products_${timestamp}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toastApi.error(error?.message || "匯出 CSV 失敗")
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

    const isConfirmed = window.confirm("這將會根據商品編號 (code) 覆蓋現有資料，並同步刪除未在匯入檔案中的商品。此操作無法復原，確定執行嗎？")
    if (!isConfirmed) return

    try {
      setIsImporting(true)
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

      const headers = parseCsvLine(csvLines[0]).map((header) => normalizeImportHeader(header))
      const requiredColumns = ["code", "name", "spec", "unit", "category", "base_price", "cost", "price", "sale_price"]

      for (const requiredColumn of requiredColumns) {
        if (!headers.includes(requiredColumn)) {
          throw new Error(`CSV 缺少必要欄位: ${requiredColumn}`)
        }
      }

      const rows: ProductCsvRow[] = csvLines.slice(1).map((line) => {
        const values = parseCsvLine(line)
        const valueByColumn = headers.reduce<Record<string, string>>((accumulator, header, index) => {
          accumulator[header] = values[index] ?? ""
          return accumulator
        }, {})

        return {
          code: (valueByColumn.code || "").trim(),
          name: (valueByColumn.name || "").trim(),
          spec: valueByColumn.spec?.trim() ? valueByColumn.spec.trim() : null,
          unit: valueByColumn.unit?.trim() ? valueByColumn.unit.trim() : null,
          category: valueByColumn.category?.trim() ? valueByColumn.category.trim() : null,
          base_price: toNumberOrZero(valueByColumn.base_price || ""),
          cost: toNumberOrZero(valueByColumn.cost || ""),
          price: toNumberOrZero(valueByColumn.price || ""),
          sale_price: toNullableNumber(valueByColumn.sale_price || ""),
        }
      })

      const upsertPayload = rows.filter((row) => row.code)
      const csvCodes = Array.from(new Set(upsertPayload.map((row) => row.code)))
      if (upsertPayload.length === 0) {
        throw new Error("沒有可匯入的資料，請確認 code 欄位")
      }

      const supabase = createClient()
      let { error } = await supabase
        .from("products")
        .upsert(upsertPayload, { onConflict: "code", on_conflict: "code" } as any)

      if (error && isBasePriceColumnMissing(error)) {
        const fallbackPayload = upsertPayload.map(({ base_price: _basePrice, ...rest }) => rest)
        const fallbackResult = await supabase
          .from("products")
          .upsert(fallbackPayload, { onConflict: "code", on_conflict: "code" } as any)
        error = fallbackResult.error
      }

      if (error) throw error

      // 匯入後自動同步刪除未在 CSV 內的商品
      const { data: existingRows, error: existingError } = await supabase
        .from("products")
        .select("code")

      if (existingError) throw existingError

      const codesToDelete = (existingRows || [])
        .map((row: { code?: string | null }) => String(row.code || "").trim())
        .filter((code) => code && !csvCodes.includes(code))

      if (codesToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from("products")
          .delete()
          .in("code", codesToDelete)

        if (deleteError) throw deleteError
      }

      toastApi.success("批次更新完成")
      window.location.reload()
    } catch (error: any) {
      toastApi.error(error?.message || "匯入失敗")
    } finally {
      setIsImporting(false)
    }
  }

    return (
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileChange}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              批次操作
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>批次操作</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExportCsv} disabled={isExporting || isImporting}>
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "匯出中..." : "匯出 CSV"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleImportClick} disabled={isExporting || isImporting}>
              <Upload className="mr-2 h-4 w-4" />
              {isImporting ? "匯入中..." : "匯入批次修改"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
}