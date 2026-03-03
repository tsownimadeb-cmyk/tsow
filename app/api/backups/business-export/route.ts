import { NextRequest, NextResponse } from "next/server"
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

    const tables = Object.fromEntries(tableQueries.map((result) => [result.table, result.rows]))
    const summary = Object.fromEntries(tableQueries.map((result) => [result.table, result.rows.length]))
    const warnings = tableQueries
      .map((result) => result.warning)
      .filter((warning): warning is string => Boolean(warning))

    const exportedAt = new Date().toISOString()
    const payload = {
      exported_at: exportedAt,
      source: "inventory-management-system",
      tables,
      summary,
      warnings,
    }

    const timestamp = exportedAt.replace(/[:.]/g, "-")
    const fileName = `business-backup-${timestamp}.json`

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename=\"${fileName}\"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "匯出失敗"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
