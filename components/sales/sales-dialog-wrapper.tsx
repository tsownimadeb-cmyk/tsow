"use client"

import React from "react"
import { SalesDialog } from "@/components/sales/sales-dialog"
import type { Customer, Product } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface Props {
  customers: Customer[]
  products: Product[]
}

export default function SalesDialogWrapper({ customers, products }: Props) {
  return (
    <SalesDialog customers={customers} products={products} mode="create">
      <Button>
        <Plus className="mr-2 h-4 w-4" />
        新增銷貨單
      </Button>
    </SalesDialog>
  )
}
