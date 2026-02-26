"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="zh-TW">
      <body>
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="space-y-4 text-center">
            <h2 className="text-xl font-semibold text-foreground">系統發生錯誤</h2>
            <p className="text-sm text-muted-foreground">請稍後再試，或重新整理頁面。</p>
            <Button onClick={() => reset()}>重試</Button>
          </div>
        </div>
      </body>
    </html>
  )
}
