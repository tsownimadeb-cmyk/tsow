import { NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import { createClient } from "@/lib/supabase/server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"

export const runtime = "nodejs"

type QueryResult = {
  table: string
  rows: Record<string, unknown>[]
  warning: string | null
}

const isMissingRelationError = (message: string) => /relation\s+"[^"]+"\s+does not exist/i.test(message)

async function queryTable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  orderBy?: Array<{ column: string; ascending: boolean }>,
): Promise<QueryResult> {
  let query = supabase.from(table).select("*")

  for (const order of orderBy || []) {
    query = query.order(order.column, { ascending: order.ascending })
  }

  const result = await query
  if (!result.error) {
    return { table, rows: (result.data || []) as Record<string, unknown>[], warning: null }
  }

  if (isMissingRelationError(result.error.message || "")) {
    return { table, rows: [], warning: `${table} 不存在，已略過` }
  }

  throw new Error(result.error.message || `查詢 ${table} 失敗`)
}

const toCellText = (value: unknown) => {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}

const escapeCsvCell = (value: string) => {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const toCsv = (rows: Record<string, unknown>[], columns: string[]) => {
  const header = columns.join(",")
  const body = rows.map((row) => columns.map((column) => escapeCsvCell(toCellText(row[column]))).join(",")).join("\r\n")
  return `\uFEFF${header}\r\n${body}`
}

const collectColumns = (rows: Record<string, unknown>[]) => {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      keys.add(key)
    }
  }
  return Array.from(keys)
}

export async function GET(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const isAuthenticated = await verifyAuthToken(cookieValue)

    if (!isAuthenticated) {
      return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
    }

    const supabase = await createClient()

    const tableQueries = await Promise.all([
      queryTable(supabase, "categories", [{ column: "name", ascending: true }]),
      queryTable(supabase, "suppliers", [{ column: "name", ascending: true }]),
      queryTable(supabase, "customers", [{ column: "code", ascending: true }]),
      queryTable(supabase, "products", [{ column: "code", ascending: true }]),
      queryTable(supabase, "purchase_orders", [
        { column: "order_date", ascending: false },
        { column: "created_at", ascending: false },
      ]),
      queryTable(supabase, "purchase_order_items", [{ column: "created_at", ascending: false }]),
      queryTable(supabase, "sales_orders", [
        { column: "order_date", ascending: false },
        { column: "created_at", ascending: false },
      ]),
      queryTable(supabase, "sales_order_items", [{ column: "created_at", ascending: false }]),
      queryTable(supabase, "accounts_receivable", [{ column: "created_at", ascending: false }]),
      queryTable(supabase, "accounts_payable", [{ column: "created_at", ascending: false }]),
    ])

    const warnings = tableQueries
      .map((result) => result.warning)
      .filter((warning): warning is string => Boolean(warning))

    const zip = new JSZip()
    for (const result of tableQueries) {
      const columns = collectColumns(result.rows)
      if (columns.length === 0) {
        zip.file(`${result.table}.csv`, "")
      } else {
        zip.file(`${result.table}.csv`, toCsv(result.rows, columns))
      }
    }

    const metadata = {
      exported_at: new Date().toISOString(),
      summary: Object.fromEntries(tableQueries.map((result) => [result.table, result.rows.length])),
      warnings,
    }
    zip.file("README.json", JSON.stringify(metadata, null, 2))

    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = `business-backup-${timestamp}.zip`

    return new NextResponse(new Uint8Array(archive), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename=\"${fileName}\"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "匯出失敗"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
