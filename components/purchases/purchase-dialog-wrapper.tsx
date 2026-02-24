"use client"

import React from "react"
import { PurchaseDialog } from "@/components/purchases/purchase-dialog"
import type { Supplier, Product } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface Props {
  suppliers: Supplier[]
  products: Product[]
}

export default function PurchaseDialogWrapper({ suppliers, products }: Props) {
  return (
    <PurchaseDialog suppliers={suppliers} products={products} mode="create">
      <Button>
        <Plus className="mr-2 h-4 w-4" />
        新增進貨單
      </Button>
    </PurchaseDialog>
  )
}
