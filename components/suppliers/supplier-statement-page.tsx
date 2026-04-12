import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { format } from "date-fns"

interface StatementRow {
  supplier_id: string
  supplier_name: string
  statement_day: number | null
  period_start: string
  period_end: string
  total_payable: number
}

export default function SupplierStatementPage() {
  const [yearMonth, setYearMonth] = useState(() => format(new Date(), "yyyy-MM"))
  const [rows, setRows] = useState<StatementRow[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      const supabase = createClient()
      const [year, month] = yearMonth.split("-").map(Number)
      // 呼叫 SQL function
      const { data, error } = await supabase.rpc("supplier_statement_payable_period", { p_year: year, p_month: month })
      if (!error && data) setRows(data)
      setLoading(false)
    }
    fetchData()
  }, [yearMonth])

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold mb-4">供應商月結應付帳款</h2>
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
            <th className="border px-2 py-1">供應商</th>
            <th className="border px-2 py-1">月結日</th>
            <th className="border px-2 py-1">週期起</th>
            <th className="border px-2 py-1">週期訖</th>
            <th className="border px-2 py-1">本期應付</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="text-center">載入中...</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={5} className="text-center">無資料</td></tr>
          ) : rows.map(row => (
            <tr key={row.supplier_id}>
              <td className="border px-2 py-1">{row.supplier_name}</td>
              <td className="border px-2 py-1">{row.statement_day ?? "-"}</td>
              <td className="border px-2 py-1">{row.period_start}</td>
              <td className="border px-2 py-1">{row.period_end}</td>
              <td className="border px-2 py-1 text-right">{row.total_payable.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
