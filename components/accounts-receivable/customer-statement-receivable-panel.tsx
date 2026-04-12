"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { format } from "date-fns"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface StatementRow {
  customer_code: string
  customer_name: string
  statement_day: number | null
  period_start: string
  period_end: string
  total_receivable: number
}

export function CustomerStatementReceivablePanel() {
  const [yearMonth, setYearMonth] = useState(() => format(new Date(), "yyyy-MM"))
  const [rows, setRows] = useState<StatementRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      setError("")
      try {
        const supabase = createClient()
        const [year, month] = yearMonth.split("-").map(Number)
        const { data, error: rpcError } = await supabase.rpc("customer_statement_receivable_period", {
          p_year: year,
          p_month: month,
        })
        if (rpcError) {
          setError(rpcError.message || "查詢失敗")
          setRows([])
        } else {
          setRows(data || [])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "發生錯誤")
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [yearMonth])

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>客戶月結應收帳款查詢</CardTitle>
        <CardDescription>根據各客戶月結日自動計算該期應收金額</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <label className="font-medium">查詢月份：</label>
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            className="border rounded px-3 py-2 text-sm"
          />
        </div>

        {error && <div className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {loading ? (
          <div className="text-center py-6 text-muted-foreground">載入中...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground">無資料</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted">
                  <th className="px-3 py-2 text-left font-semibold">客戶名稱</th>
                  <th className="px-3 py-2 text-left font-semibold">月結日</th>
                  <th className="px-3 py-2 text-left font-semibold">週期起</th>
                  <th className="px-3 py-2 text-left font-semibold">週期訖</th>
                  <th className="px-3 py-2 text-right font-semibold">本期應收</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.customer_code} className="border-b hover:bg-muted/50">
                    <td className="px-3 py-2">{row.customer_name}</td>
                    <td className="px-3 py-2">{row.statement_day ?? "-"}</td>
                    <td className="px-3 py-2">{row.period_start}</td>
                    <td className="px-3 py-2">{row.period_end}</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {(row.total_receivable || 0).toLocaleString("zh-TW", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
