"use client"

import { useRef, useState, type ChangeEvent } from "react"
import { useRouter } from "next/navigation"
import { Download, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

type SupplierCsvRow = {
  id: string
  name: string
  contact_person: string
  phone: string
  email: string
  address: string
  notes: string
}

const CSV_COLUMNS: Array<keyof SupplierCsvRow> = ["id", "name", "contact_person", "phone", "email", "address", "notes"]

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

export function SuppliersBatchActions() {
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

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
        .from("suppliers")
        .select("id,name,contact_person,phone,email,address,notes")
        .order("created_at", { ascending: false })

      if (error) throw error

      const rows: SupplierCsvRow[] = ((data || []) as any[]).map((row) => ({
        id: String(row.id ?? "").trim(),
        name: String(row.name ?? "").trim(),
        contact_person: String(row.contact_person ?? "").trim(),
        phone: String(row.phone ?? "").trim(),
        email: String(row.email ?? "").trim(),
        address: String(row.address ?? "").trim(),
        notes: String(row.notes ?? "").trim(),
      }))

      const header = CSV_COLUMNS.join(",")
      const csvRows = rows.map((row) => CSV_COLUMNS.map((column) => escapeCsvValue(row[column])).join(","))
      const csvContent = `\uFEFF${[header, ...csvRows].join("\n")}`

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `suppliers_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toastApi.error(error?.message || "匯出供應商 CSV 失敗")
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

    const isConfirmed = window.confirm("這將根據 id 覆蓋現有供應商資料，確定執行嗎？")
    if (!isConfirmed) return

    try {
      setIsImporting(true)

      const rawText = await file.text()
      const text = rawText.replace(/^\uFEFF/, "")
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

      if (lines.length < 2) {
        throw new Error("CSV 內容不足，至少需要標題列與一筆資料")
      }

      const headers = parseCsvLine(lines[0]).map((header) => sanitizeCsvHeader(header))
      for (const requiredColumn of CSV_COLUMNS) {
        if (!headers.includes(requiredColumn)) {
          throw new Error(`CSV 缺少必要欄位：${requiredColumn}`)
        }
      }

      const payload = lines
        .slice(1)
        .map((line, index) => {
          const values = parseCsvLine(line)
          const valueByColumn = headers.reduce<Record<string, string>>((accumulator, header, columnIndex) => {
            accumulator[header] = values[columnIndex] ?? ""
            return accumulator
          }, {})

          const name = String(valueByColumn.name || "").trim()
          if (!name) {
            throw new Error(`第 ${index + 2} 列失敗：name 不可為空`)
          }

          return {
            id: String(valueByColumn.id || "").trim() || createUuid(),
            name,
            contact_person: String(valueByColumn.contact_person || "").trim() || null,
            phone: String(valueByColumn.phone || "").trim() || null,
            email: String(valueByColumn.email || "").trim() || null,
            address: String(valueByColumn.address || "").trim() || null,
            notes: String(valueByColumn.notes || "").trim() || null,
          }
        })
        .filter((row) => row.name)

      if (!payload.length) {
        throw new Error("沒有可匯入的供應商資料")
      }

      const supabase = createClient()
      const { error } = await supabase.from("suppliers").upsert(payload, { onConflict: "id", on_conflict: "id" } as any)
      if (error) throw error

      toastApi.success("供應商資料批次更新完成")
      router.refresh()
    } catch (error: any) {
      toastApi.error(error?.message || "匯入供應商資料失敗")
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
      <Button variant="outline" onClick={handleExportCsv} disabled={isExporting || isImporting}>
        <Download className="mr-2 h-4 w-4" />
        {isExporting ? "匯出中..." : "匯出供應商 CSV"}
      </Button>
      <Button variant="outline" onClick={handleImportClick} disabled={isExporting || isImporting}>
        <Upload className="mr-2 h-4 w-4" />
        {isImporting ? "匯入中..." : "匯入批次修改"}
      </Button>
    </>
  )
}
