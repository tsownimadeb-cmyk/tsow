import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { format } from "date-fns"

interface StatementRow {
  customer_code: string
  customer_name: string
  statement_day: number | null
  period_start: string
  period_end: string
  total_receivable: number
}

export default function CustomerStatementPage() {
  const [yearMonth, setYearMonth] = useState(() => format(new Date(), "yyyy-MM"))
  const [rows, setRows] = useState<StatementRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      const supabase = createClient()
      const [year, month] = yearMonth.split("-").map(Number)
      // 呼叫 SQL function
      const { data, error } = await supabase.rpc("customer_statement_receivable_period", { p_year: year, p_month: month })
      if (!error && data) setRows(data)
      setLoading(false)
    }
    fetchData()
  }, [yearMonth])

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold mb-4">客戶月結應收帳款</h2>
      <div className="mb-4">
        <label className="mr-2">查詢月份：</label>
        <input
          type="month"
          value={yearMonth}
          onChange={e => setYearMonth(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </div>
      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-2 py-1">客戶</th>
            <th className="border px-2 py-1">月結日</th>
            <th className="border px-2 py-1">週期起</th>
            <th className="border px-2 py-1">週期訖</th>
            <th className="border px-2 py-1">本期應收</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="text-center">載入中...</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={5} className="text-center">無資料</td></tr>
          ) : rows.map(row => (
            <tr key={row.customer_code}>
              <td className="border px-2 py-1">{row.customer_name}</td>
              <td className="border px-2 py-1">{row.statement_day ?? "-"}</td>
              <td className="border px-2 py-1">{row.period_start}</td>
              <td className="border px-2 py-1">{row.period_end}</td>
              <td className="border px-2 py-1 text-right">{row.total_receivable.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
