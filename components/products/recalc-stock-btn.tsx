"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export function RecalcStockBtn() {
  const [loading, setLoading] = useState(false)

  const handleRecalc = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/products/recalculate-stock", { method: "POST" })
      const data = await res.json()
      if (data.success) {
        alert("庫存重算完成！")
        window.location.reload()
      } else {
        alert("庫存重算失敗：" + (data.message || "") + (data.error ? "\n錯誤詳情：" + data.error : ""))
      }
    } catch (e) {
      alert("庫存重算發生錯誤")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      id="recalc-stock-btn"
      type="button"
      className="ml-2"
      onClick={handleRecalc}
      disabled={loading}
    >
      {loading ? "重算中..." : "庫存重算"}
    </Button>
  )
}
