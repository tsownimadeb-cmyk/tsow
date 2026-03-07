"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Eye, Printer } from "lucide-react"

export function TodayPrintControls() {
  const [isPreviewMode, setIsPreviewMode] = useState(false)

  useEffect(() => {
    const className = "print-preview-mode"
    if (isPreviewMode) {
      document.body.classList.add(className)
    } else {
      document.body.classList.remove(className)
    }

    return () => {
      document.body.classList.remove(className)
    }
  }, [isPreviewMode])

  return (
    <div className="flex items-center gap-2 print:hidden">
      <Button variant="outline" asChild>
        <Link href="/sales">
          <ArrowLeft className="h-4 w-4" />
          返回銷貨管理
        </Link>
      </Button>
      <Button variant="secondary" onClick={() => setIsPreviewMode((current) => !current)}>
        <Eye className="h-4 w-4" />
        {isPreviewMode ? "關閉預覽" : "預覽列印"}
      </Button>
      <Button onClick={() => window.print()}>
        <Printer className="h-4 w-4" />
        列印今日出貨單
      </Button>
    </div>
  )
}
